using System.Runtime.InteropServices;
using System.Security.Principal;
using LibreHardwareMonitor.Hardware;
using Microsoft.Extensions.Options;

namespace PcMonitor.Service;

/// <summary>Reads CPU/GPU/fan sensors through LibreHardwareMonitorLib, plus RAM and network from Windows APIs.</summary>
public sealed class SensorReader : IDisposable
{
    private readonly Computer _computer;
    private readonly UpdateVisitor _visitor = new();
    private readonly NetworkSampler _network = new();
    private readonly object _lock = new();
    private readonly bool _isElevated;
    private bool _opened;

    public SensorReader(IOptions<MonitorOptions> options)
    {
        _computer = new Computer
        {
            IsCpuEnabled = true,
            IsGpuEnabled = true,
            // Motherboard Super I/O chips carry the case/CPU fan headers.
            IsMotherboardEnabled = true,
            IsControllerEnabled = options.Value.EnableControllers,
        };

        using var identity = WindowsIdentity.GetCurrent();
        _isElevated = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
    }

    public Snapshot Read()
    {
        lock (_lock)
        {
            EnsureOpen();
            _computer.Accept(_visitor);

            return new Snapshot(
                DateTimeOffset.Now,
                _isElevated,
                IsPawnIOInstalled(),
                ReadCpu(),
                ReadGpu(),
                ReadMemory(),
                _network.Sample(),
                ReadFans());
        }
    }

    public IReadOnlyList<SensorInfo> ReadAll()
    {
        lock (_lock)
        {
            EnsureOpen();
            _computer.Accept(_visitor);

            var list = new List<SensorInfo>();
            foreach (var hw in _computer.Hardware)
                Collect(hw, list);
            return list;
        }
    }

    private static void Collect(IHardware hw, List<SensorInfo> list)
    {
        foreach (var s in hw.Sensors)
            list.Add(new SensorInfo(hw.Name, hw.HardwareType.ToString(), s.Name, s.SensorType.ToString(), s.Value));
        foreach (var sub in hw.SubHardware)
            Collect(sub, list);
    }

    private void EnsureOpen()
    {
        if (_opened) return;
        _computer.Open();
        _opened = true;
    }

    private DeviceReading ReadCpu()
    {
        var cpu = _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.Cpu);
        if (cpu is null) return new DeviceReading(null, null, null);

        var sensors = AllSensors(cpu).ToList();
        var load = Find(sensors, SensorType.Load, "CPU Total");
        var temp = Find(sensors, SensorType.Temperature, "Core (Tctl/Tdie)", "CPU Package", "Core (Tctl)", "Core (Tdie)", "Core Average")
                   ?? sensors.Where(s => s.SensorType == SensorType.Temperature && s.Value is > 0).Max(s => s.Value);

        return new DeviceReading(cpu.Name, load, temp);
    }

    private DeviceReading ReadGpu()
    {
        // Prefer a discrete GPU over integrated graphics.
        var gpu = _computer.Hardware.FirstOrDefault(h => h.HardwareType is HardwareType.GpuNvidia or HardwareType.GpuAmd)
                  ?? _computer.Hardware.FirstOrDefault(h => h.HardwareType == HardwareType.GpuIntel);
        if (gpu is null) return new DeviceReading(null, null, null);

        var sensors = AllSensors(gpu).ToList();
        var load = Find(sensors, SensorType.Load, "GPU Core", "D3D 3D");
        var temp = Find(sensors, SensorType.Temperature, "GPU Core", "GPU Hot Spot");

        return new DeviceReading(gpu.Name, load, temp);
    }

    private DateTime _pawnIOCheckedAt = DateTime.MinValue;
    private bool _pawnIO;

    /// <summary>PawnIO registers as a kernel driver service; re-checked once a minute so a later install is picked up.</summary>
    private bool IsPawnIOInstalled()
    {
        if (DateTime.UtcNow - _pawnIOCheckedAt < TimeSpan.FromMinutes(1)) return _pawnIO;
        _pawnIOCheckedAt = DateTime.UtcNow;
        try
        {
            _pawnIO = System.ServiceProcess.ServiceController.GetDevices()
                .Any(d => string.Equals(d.ServiceName, "PawnIO", StringComparison.OrdinalIgnoreCase));
        }
        catch
        {
            _pawnIO = false;
        }
        return _pawnIO;
    }

    private FanReading[] ReadFans()
    {
        var all = _computer.Hardware.SelectMany(hw => AllSensors(hw).Select(s => (Top: hw, Sensor: s))).ToList();
        return all
            .Where(x => x.Sensor.SensorType == SensorType.Fan && x.Sensor.Value.HasValue)
            .Select(x => new FanReading(x.Sensor.Identifier.ToString(), x.Sensor.Name, x.Top.Name,
                MathF.Round(x.Sensor.Value!.Value), DutyPercent(x.Sensor, all.Select(a => a.Sensor))))
            .ToArray();
    }

    /// <summary>
    /// Finds the fan-control (duty %) sensor that drives <paramref name="fan"/> on the same chip. Names pair up as
    /// "GPU Fan 1" / "GPU Fan 1" (NVIDIA), "Pump" / "Pump Control" (Kraken) and "Fan #2" / "Fan Control #2"
    /// (Super I/O); otherwise fall back to the sensor index.
    /// </summary>
    private static float? DutyPercent(ISensor fan, IEnumerable<ISensor> sensors)
    {
        var controls = sensors.Where(s => s.SensorType == SensorType.Control && s.Hardware == fan.Hardware && s.Value.HasValue).ToList();
        var match = controls.FirstOrDefault(c => c.Name == fan.Name)
                    ?? controls.FirstOrDefault(c => c.Name == fan.Name + " Control")
                    ?? controls.FirstOrDefault(c => c.Name == fan.Name.Replace("Fan", "Fan Control"))
                    ?? controls.FirstOrDefault(c => c.Index == fan.Index);
        return match?.Value is { } v ? MathF.Round(v) : null;
    }

    private static MemoryReading ReadMemory()
    {
        var status = new MemoryStatusEx { dwLength = (uint)Marshal.SizeOf<MemoryStatusEx>() };
        if (!GlobalMemoryStatusEx(ref status))
            return new MemoryReading(0, 0, 0);

        const double gb = 1024d * 1024 * 1024;
        var total = status.ullTotalPhys / gb;
        var used = (status.ullTotalPhys - status.ullAvailPhys) / gb;
        return new MemoryReading(Math.Round(used, 2), Math.Round(total, 2), status.dwMemoryLoad);
    }

    private static IEnumerable<ISensor> AllSensors(IHardware hw) =>
        hw.Sensors.Concat(hw.SubHardware.SelectMany(AllSensors));

    private static float? Find(List<ISensor> sensors, SensorType type, params string[] names)
    {
        foreach (var name in names)
        {
            // Without the kernel driver (not elevated) temperatures read as 0, which is never a real value.
            var match = sensors.FirstOrDefault(s => s.SensorType == type && s.Name == name && s.Value.HasValue
                                                    && (type != SensorType.Temperature || s.Value > 0));
            if (match is not null) return match.Value;
        }
        return null;
    }

    public void Dispose()
    {
        lock (_lock)
        {
            if (_opened) _computer.Close();
        }
    }

    private sealed class UpdateVisitor : IVisitor
    {
        public void VisitComputer(IComputer computer) => computer.Traverse(this);

        public void VisitHardware(IHardware hardware)
        {
            hardware.Update();
            foreach (var sub in hardware.SubHardware)
                sub.Accept(this);
        }

        public void VisitSensor(ISensor sensor) { }
        public void VisitParameter(IParameter parameter) { }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MemoryStatusEx
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MemoryStatusEx buffer);
}

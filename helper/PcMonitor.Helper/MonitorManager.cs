using System.Runtime.InteropServices;

namespace PcMonitor.Helper;

/// <summary>
/// Enumerates physical monitors and reads/writes DDC/CI VCP features (brightness, contrast),
/// the same mechanism Monitorian uses for external monitors.
/// </summary>
public sealed class MonitorManager : IDisposable
{
    private const byte VcpBrightness = 0x10;
    private const byte VcpContrast = 0x12;

    /// <summary>Physical monitor handles from the last <see cref="List"/>, keyed by monitor id.</summary>
    private readonly Dictionary<string, IntPtr> _handles = new();
    private readonly List<Native.PHYSICAL_MONITOR[]> _allocated = new();

    public MonitorInfo[] List()
    {
        Release();

        var names = DisplayNames();
        var result = new List<MonitorInfo>();

        foreach (var (hMonitor, gdiName) in DisplayMonitors())
        {
            if (!Native.GetNumberOfPhysicalMonitorsFromHMONITOR(hMonitor, out var count) || count == 0) continue;

            var physical = new Native.PHYSICAL_MONITOR[count];
            if (!Native.GetPhysicalMonitorsFromHMONITOR(hMonitor, count, physical)) continue;
            _allocated.Add(physical);

            names.TryGetValue(gdiName, out var targets);
            for (var i = 0; i < physical.Length; i++)
            {
                // In clone mode one GDI source drives several targets; pair them by order.
                var target = targets is not null && i < targets.Count ? targets[i] : default;
                var id = target.DevicePath ?? $"{gdiName}#{i}";
                var name = string.IsNullOrWhiteSpace(target.FriendlyName) ? physical[i].szPhysicalMonitorDescription : target.FriendlyName;

                _handles[id] = physical[i].hPhysicalMonitor;
                result.Add(new MonitorInfo(id, name, Read(physical[i].hPhysicalMonitor, VcpBrightness),
                    Read(physical[i].hPhysicalMonitor, VcpContrast)));
            }
        }

        return result.ToArray();
    }

    public void Set(string monitorId, byte code, uint value)
    {
        if (_handles.Count == 0) List();
        if (!_handles.TryGetValue(monitorId, out var handle))
            throw new InvalidOperationException($"monitor not found: {monitorId}");
        if (!Native.SetVCPFeature(handle, code, value))
            throw new InvalidOperationException($"DDC/CI write failed (error {Marshal.GetLastWin32Error()})");
    }

    private static VcpValue? Read(IntPtr handle, byte code) =>
        Native.GetVCPFeatureAndVCPFeatureReply(handle, code, IntPtr.Zero, out var current, out var max) && max > 0
            ? new VcpValue(current, max)
            : null;

    private static List<(IntPtr Handle, string GdiName)> DisplayMonitors()
    {
        var list = new List<(IntPtr, string)>();
        Native.EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMonitor, _, _, _) =>
        {
            var info = new Native.MONITORINFOEX { cbSize = Marshal.SizeOf<Native.MONITORINFOEX>() };
            if (Native.GetMonitorInfo(hMonitor, ref info)) list.Add((hMonitor, info.szDevice));
            return true;
        }, IntPtr.Zero);
        return list;
    }

    /// <summary>Maps GDI source names (\\.\DISPLAY1) to the EDID friendly name and device path of each target.</summary>
    private static Dictionary<string, List<(string? FriendlyName, string? DevicePath)>> DisplayNames()
    {
        var map = new Dictionary<string, List<(string?, string?)>>(StringComparer.OrdinalIgnoreCase);
        if (Native.GetDisplayConfigBufferSizes(Native.QDC_ONLY_ACTIVE_PATHS, out var pathCount, out var modeCount) != 0)
            return map;

        var paths = new Native.DISPLAYCONFIG_PATH_INFO[pathCount];
        var modes = new Native.DISPLAYCONFIG_MODE_INFO[modeCount];
        if (Native.QueryDisplayConfig(Native.QDC_ONLY_ACTIVE_PATHS, ref pathCount, paths, ref modeCount, modes, IntPtr.Zero) != 0)
            return map;

        foreach (var path in paths.Take((int)pathCount))
        {
            var source = new Native.DISPLAYCONFIG_SOURCE_DEVICE_NAME
            {
                header = Header(Native.DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, Marshal.SizeOf<Native.DISPLAYCONFIG_SOURCE_DEVICE_NAME>(),
                    path.sourceInfo.adapterId, path.sourceInfo.id),
            };
            var target = new Native.DISPLAYCONFIG_TARGET_DEVICE_NAME
            {
                header = Header(Native.DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME, Marshal.SizeOf<Native.DISPLAYCONFIG_TARGET_DEVICE_NAME>(),
                    path.targetInfo.adapterId, path.targetInfo.id),
            };
            if (Native.DisplayConfigGetDeviceInfo(ref source) != 0 || Native.DisplayConfigGetDeviceInfo(ref target) != 0) continue;

            if (!map.TryGetValue(source.viewGdiDeviceName, out var targets))
                map[source.viewGdiDeviceName] = targets = new List<(string?, string?)>();
            targets.Add((target.monitorFriendlyDeviceName, target.monitorDevicePath));
        }

        return map;
    }

    private static Native.DISPLAYCONFIG_DEVICE_INFO_HEADER Header(int type, int size, Native.LUID adapter, uint id) =>
        new() { type = type, size = (uint)size, adapterId = adapter, id = id };

    private void Release()
    {
        foreach (var physical in _allocated)
            Native.DestroyPhysicalMonitors((uint)physical.Length, physical);
        _allocated.Clear();
        _handles.Clear();
    }

    public void Dispose() => Release();
}

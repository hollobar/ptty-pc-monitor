namespace PcMonitor.Service;

public sealed class MonitorOptions
{
    public int Port { get; set; } = 47321;
    public int UpdateIntervalMs { get; set; } = 1000;

    /// <summary>Read USB controllers such as NZXT Kraken (pump/radiator fans).</summary>
    public bool EnableControllers { get; set; } = true;
}

public sealed record DeviceReading(string? Name, float? Load, float? Temperature);

/// <summary>A fan or pump speed sensor. <see cref="Id"/> is LibreHardwareMonitor's stable sensor identifier.</summary>
/// <param name="Percent">Fan duty (0–100 %) from the matching fan-control sensor, or null when there is none.</param>
public sealed record FanReading(string Id, string Name, string Hardware, float Rpm, float? Percent);

public sealed record MemoryReading(double UsedGB, double TotalGB, float Load);

public sealed record NetworkReading(double DownloadBytesPerSec, double UploadBytesPerSec, string[] Adapters);

public sealed record Snapshot(
    DateTimeOffset Timestamp,
    bool IsElevated,
    /// <summary>Whether the PawnIO kernel driver (needed for CPU temperature and motherboard fans) is installed.</summary>
    bool PawnIO,
    DeviceReading Cpu,
    DeviceReading Gpu,
    MemoryReading Memory,
    NetworkReading Network,
    FanReading[] Fans);

public sealed record SensorInfo(string Hardware, string HardwareType, string Sensor, string Type, float? Value);

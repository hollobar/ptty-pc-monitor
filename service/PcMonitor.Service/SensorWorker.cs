using Microsoft.Extensions.Options;

namespace PcMonitor.Service;

/// <summary>Polls the sensors on a fixed interval and keeps the latest snapshot for the HTTP API.</summary>
public sealed class SensorWorker(SensorReader reader, IOptions<MonitorOptions> options, ILogger<SensorWorker> logger)
    : BackgroundService
{
    private static Snapshot? _latest;

    public static Snapshot? Latest => Volatile.Read(ref _latest);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromMilliseconds(Math.Max(250, options.Value.UpdateIntervalMs));
        using var timer = new PeriodicTimer(interval);

        do
        {
            try
            {
                Volatile.Write(ref _latest, reader.Read());
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to read sensors");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}

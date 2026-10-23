using System.Net;
using System.Text;
using System.Text.Json;
using Microsoft.Extensions.Options;

namespace PcMonitor.Service;

/// <summary>
/// Serves sensor data as JSON on http://localhost:{Port}/ (loopback only).
///   GET /api/sensors      latest snapshot used by the Stream Deck plugin
///   GET /api/sensors/all  every sensor LibreHardwareMonitor sees (for troubleshooting)
/// </summary>
public sealed class HttpApi(SensorReader reader, IOptions<MonitorOptions> options, ILogger<HttpApi> logger)
    : BackgroundService
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { WriteIndented = true };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var listener = new HttpListener();
        listener.Prefixes.Add($"http://localhost:{options.Value.Port}/");
        listener.Start();
        logger.LogInformation("Listening on http://localhost:{Port}/api/sensors", options.Value.Port);

        await using var stopRegistration = stoppingToken.Register(listener.Stop);

        while (!stoppingToken.IsCancellationRequested)
        {
            HttpListenerContext context;
            try
            {
                context = await listener.GetContextAsync();
            }
            catch when (stoppingToken.IsCancellationRequested)
            {
                break;
            }

            _ = Task.Run(() => Handle(context), stoppingToken);
        }
    }

    private void Handle(HttpListenerContext context)
    {
        var response = context.Response;
        try
        {
            var path = context.Request.Url?.AbsolutePath.TrimEnd('/') ?? "";
            object? body = path switch
            {
                "/api/sensors" => SensorWorker.Latest,
                "/api/sensors/all" => reader.ReadAll(),
                _ => null,
            };

            if (body is null)
            {
                response.StatusCode = path == "/api/sensors" ? 503 : 404;
                return;
            }

            var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(body, Json));
            response.ContentType = "application/json; charset=utf-8";
            response.Headers["Cache-Control"] = "no-store";
            response.ContentLength64 = bytes.Length;
            response.OutputStream.Write(bytes);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Request failed");
            response.StatusCode = 500;
        }
        finally
        {
            response.Close();
        }
    }
}

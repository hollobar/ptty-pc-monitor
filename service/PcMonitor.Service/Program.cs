using PcMonitor.Service;

// Run from the exe's folder so appsettings.json is found when started by the Service Control Manager.
var builder = Host.CreateApplicationBuilder(new HostApplicationBuilderSettings
{
    Args = args,
    ContentRootPath = AppContext.BaseDirectory,
});

builder.Services.AddWindowsService(options => options.ServiceName = "PcMonitorService");
builder.Services.Configure<MonitorOptions>(builder.Configuration.GetSection("PcMonitor"));
builder.Services.AddSingleton<SensorReader>();
builder.Services.AddHostedService<SensorWorker>();
builder.Services.AddHostedService<HttpApi>();

builder.Build().Run();

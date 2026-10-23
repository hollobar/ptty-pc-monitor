using System.Text.Json;
using System.Text.Json.Serialization;
using PcMonitor.Helper;

// Line-based JSON protocol over stdin/stdout, driven by the Stream Deck plugin.
//   {"id":1,"cmd":"list"}                                   -> {"id":1,"ok":true,"monitors":[...]}
//   {"id":2,"cmd":"set","monitor":"<id>","code":16,"value":70} -> {"id":2,"ok":true}
//   {"id":3,"cmd":"frames","path":"C:\\bg.gif","size":144,"scale":1,"offsetX":0,"offsetY":0,
//    "cropLeft":0,"cropTop":0,"cropRight":1,"cropBottom":1}
//                                                           -> {"id":3,"ok":true,"frames":[{"png":"<base64>","delay":100}]}
//   {"id":4,"cmd":"fonts"}                                  -> {"id":4,"ok":true,"fonts":["Arial","Malgun Gothic",...]}
//   {"id":5,"cmd":"thumbnail","path":"C:\\bg.gif","size":288} -> {"id":5,"ok":true,"thumbnail":{"png":"...","width":512,"height":288}}
// VCP codes: 0x10 (16) brightness, 0x12 (18) contrast.
// Runs in the user's session because DDC/CI is not reachable from a service (session 0).

using var monitors = new MonitorManager();
using var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
// Explicit UTF-8: Console.In would use the OEM code page (CP949) and garble Korean file paths.
using var stdin = new StreamReader(Console.OpenStandardInput(), System.Text.Encoding.UTF8);

string? line;
while ((line = stdin.ReadLine()) is not null)
{
    if (string.IsNullOrWhiteSpace(line)) continue;

    Response response;
    Request? request = null;
    try
    {
        request = JsonSerializer.Deserialize(line, ProtocolJson.Default.Request)
                  ?? throw new InvalidOperationException("empty request");

        response = request.Cmd switch
        {
            "list" => new Response(request.Id, true) { Monitors = monitors.List() },
            "set" => Set(request),
            "frames" => new Response(request.Id, true)
            {
                Frames = ImageFrames.Load(
                    request.Path ?? throw new InvalidOperationException("frames requires path"),
                    Math.Clamp(request.Size ?? 144, 16, 512),
                    Math.Clamp(request.Scale ?? 1, 0.05, 10),
                    request.OffsetX ?? 0,
                    request.OffsetY ?? 0,
                    ImageFrames.Crop.From(request.CropLeft, request.CropTop, request.CropRight, request.CropBottom)),
            },
            "thumbnail" => new Response(request.Id, true)
            {
                Thumbnail = ImageFrames.Thumbnail(
                    request.Path ?? throw new InvalidOperationException("thumbnail requires path"),
                    Math.Clamp(request.Size ?? 288, 16, 1024)),
            },
            "fonts" => new Response(request.Id, true)
            {
                // Installed font families, as Stream Deck's SVG renderer resolves them by family name.
                Fonts = SkiaSharp.SKFontManager.Default.FontFamilies
                    .Where(f => !f.StartsWith('@')) // vertical-writing variants
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .Order(StringComparer.OrdinalIgnoreCase)
                    .ToArray(),
            },
            _ => throw new InvalidOperationException($"unknown command '{request.Cmd}'"),
        };
    }
    catch (Exception ex)
    {
        response = new Response(request?.Id ?? 0, false) { Error = ex.Message };
    }

    stdout.WriteLine(JsonSerializer.Serialize(response, ProtocolJson.Default.Response));
}

Response Set(Request request)
{
    if (request.Monitor is null || request.Code is null || request.Value is null)
        throw new InvalidOperationException("set requires monitor, code and value");

    monitors.Set(request.Monitor, (byte)request.Code.Value, (uint)Math.Max(0, request.Value.Value));
    return new Response(request.Id, true);
}

namespace PcMonitor.Helper
{
    public sealed record Request(
        int Id, string Cmd, string? Monitor, int? Code, int? Value, string? Path, int? Size,
        double? Scale, double? OffsetX, double? OffsetY,
        double? CropLeft, double? CropTop, double? CropRight, double? CropBottom);

    public sealed record Response(int Id, bool Ok)
    {
        public MonitorInfo[]? Monitors { get; init; }
        public FrameInfo[]? Frames { get; init; }
        public ThumbnailInfo? Thumbnail { get; init; }
        public string[]? Fonts { get; init; }
        public string? Error { get; init; }
    }

    public sealed record FrameInfo(string Png, int Delay);

    public sealed record ThumbnailInfo(string Png, int Width, int Height);

    public sealed record VcpValue(uint Current, uint Max);

    public sealed record MonitorInfo(string Id, string Name, VcpValue? Brightness, VcpValue? Contrast);

    [JsonSourceGenerationOptions(JsonSerializerDefaults.Web, DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]
    [JsonSerializable(typeof(Request))]
    [JsonSerializable(typeof(Response))]
    internal partial class ProtocolJson : JsonSerializerContext;
}

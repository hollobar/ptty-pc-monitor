using SkiaSharp;

namespace PcMonitor.Helper;

/// <summary>Decodes a still or animated image (PNG, JPEG, BMP, GIF, WebP) into key-sized PNG frames.</summary>
public static class ImageFrames
{
    /// <summary>Upper bound so a long GIF can't exhaust memory or flood Stream Deck.</summary>
    private const int MaxFrames = 300;
    private const int DefaultDelayMs = 100;
    /// <summary>Offsets are given in Stream Deck key pixels (a key is 144x144).</summary>
    private const double KeyUnits = 144;

    /// <summary>
    /// Renders every frame onto a <paramref name="size"/> square. The image is first cut to <paramref name="crop"/>
    /// (fractions of the image), then placed: at <paramref name="scale"/> 1 the cropped part covers the square
    /// (shorter side fits) and <paramref name="offsetX"/>/<paramref name="offsetY"/> move its center.
    /// </summary>
    public static FrameInfo[] Load(string path, int size, double scale, double offsetX, double offsetY, Crop crop)
    {
        using var data = ReadFile(path);
        using var codec = SKCodec.Create(data) ?? throw new InvalidOperationException("지원하지 않는 이미지 형식입니다.");

        var info = new SKImageInfo(codec.Info.Width, codec.Info.Height, SKColorType.Rgba8888, SKAlphaType.Premul);
        var frameInfos = codec.FrameInfo;
        var count = Math.Clamp(codec.FrameCount, 1, MaxFrames);

        // Animated frames may be deltas on top of an earlier frame; keep the full canvases that later frames need.
        var required = frameInfos.Select(f => f.RequiredFrame).Where(r => r >= 0).ToHashSet();
        var kept = new Dictionary<int, SKBitmap>();
        var result = new FrameInfo[count];

        try
        {
            for (var i = 0; i < count; i++)
            {
                var prior = i < frameInfos.Length ? frameInfos[i].RequiredFrame : -1;
                var canvas = prior >= 0 && kept.TryGetValue(prior, out var basis) ? basis.Copy() : new SKBitmap(info);
                if (prior < 0) canvas.Erase(SKColors.Transparent);

                var options = new SKCodecOptions(i, prior >= 0 && kept.ContainsKey(prior) ? prior : -1);
                var status = codec.GetPixels(info, canvas.GetPixels(), options);
                if (status is not (SKCodecResult.Success or SKCodecResult.IncompleteInput))
                    throw new InvalidOperationException($"이미지를 읽지 못했습니다 ({status}).");

                var delay = i < frameInfos.Length ? frameInfos[i].Duration : DefaultDelayMs;
                result[i] = new FrameInfo(EncodePlaced(canvas, size, scale, offsetX, offsetY, crop), delay < 20 ? DefaultDelayMs : delay);

                if (required.Contains(i)) kept[i] = canvas;
                else canvas.Dispose();
            }
        }
        finally
        {
            foreach (var bitmap in kept.Values) bitmap.Dispose();
        }

        return result;
    }

    /// <summary>The whole first frame, uncropped, with its shorter side scaled to <paramref name="size"/> (for the layout editor).</summary>
    public static ThumbnailInfo Thumbnail(string path, int size)
    {
        using var data = ReadFile(path);
        using var bitmap = SKBitmap.Decode(data) ?? throw new InvalidOperationException("지원하지 않는 이미지 형식입니다.");

        var s = (double)size / Math.Min(bitmap.Width, bitmap.Height);
        var width = Math.Max(1, (int)Math.Round(bitmap.Width * s));
        var height = Math.Max(1, (int)Math.Round(bitmap.Height * s));

        using var surface = SKSurface.Create(new SKImageInfo(width, height, SKColorType.Rgba8888, SKAlphaType.Premul));
        using var image = SKImage.FromBitmap(bitmap);
        surface.Canvas.Clear(SKColors.Transparent);
        surface.Canvas.DrawImage(image, SKRect.Create(width, height), new SKSamplingOptions(SKCubicResampler.Mitchell));
        return new ThumbnailInfo(Encode(surface), width, height);
    }

    private static SKData ReadFile(string path)
    {
        if (!File.Exists(path)) throw new FileNotFoundException("이미지 파일을 찾을 수 없습니다.", path);
        // Read through .NET: Skia's own file opening fails on non-ASCII (e.g. Korean) paths.
        return SKData.CreateCopy(File.ReadAllBytes(path));
    }

    private static string EncodePlaced(SKBitmap source, int size, double scale, double offsetX, double offsetY, Crop crop)
    {
        var src = SKRect.Create(
            (float)(source.Width * crop.Left), (float)(source.Height * crop.Top),
            (float)(source.Width * (crop.Right - crop.Left)), (float)(source.Height * (crop.Bottom - crop.Top)));

        var s = (double)size / Math.Min(src.Width, src.Height) * scale;
        var width = (float)(src.Width * s);
        var height = (float)(src.Height * s);
        var unit = size / KeyUnits;
        var centerX = (float)(size / 2.0 + offsetX * unit);
        var centerY = (float)(size / 2.0 + offsetY * unit);

        using var surface = SKSurface.Create(new SKImageInfo(size, size, SKColorType.Rgba8888, SKAlphaType.Premul));
        using var image = SKImage.FromBitmap(source);
        surface.Canvas.Clear(SKColors.Transparent);
        surface.Canvas.DrawImage(image, src, SKRect.Create(centerX - width / 2, centerY - height / 2, width, height),
            new SKSamplingOptions(SKCubicResampler.Mitchell));
        return Encode(surface);
    }

    /// <summary>Part of the image to keep, as fractions (0–1) of its width and height.</summary>
    public readonly record struct Crop(double Left, double Top, double Right, double Bottom)
    {
        private const double MinSpan = 0.01;

        public static Crop From(double? left, double? top, double? right, double? bottom)
        {
            var l = Math.Clamp(left ?? 0, 0, 1 - MinSpan);
            var t = Math.Clamp(top ?? 0, 0, 1 - MinSpan);
            return new Crop(l, t, Math.Clamp(right ?? 1, l + MinSpan, 1), Math.Clamp(bottom ?? 1, t + MinSpan, 1));
        }
    }

    private static string Encode(SKSurface surface)
    {
        using var snapshot = surface.Snapshot();
        using var data = snapshot.Encode(SKEncodedImageFormat.Png, 100);
        return Convert.ToBase64String(data.AsSpan());
    }
}

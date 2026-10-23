# Third-party notices

Ptty PC Monitor includes the following third-party software. Each component is used unmodified and
remains under its own license.

## Sensor service (`PcMonitorService.exe`)

| Component | Version | License | Source |
|---|---|---|---|
| LibreHardwareMonitorLib | 0.9.6 | MPL-2.0 | https://github.com/LibreHardwareMonitor/LibreHardwareMonitor |
| BlackSharp.Core | 1.0.7 | MPL-2.0 | https://www.nuget.org/packages/BlackSharp.Core |
| DiskInfoToolkit | 1.1.2 | MPL-2.0 | https://www.nuget.org/packages/DiskInfoToolkit |
| RAMSPDToolkit-NDD | 1.4.2 | MPL-2.0 | https://www.nuget.org/packages/RAMSPDToolkit-NDD |
| HidSharp | 2.6.4 | Apache-2.0 | https://www.zer7.com/software/hidsharp |
| Mono.Posix.NETStandard | 1.0.0 | MIT | https://github.com/mono/mono |
| .NET runtime and Microsoft.Extensions.* / System.* libraries | 10.0 | MIT | https://github.com/dotnet/runtime |

The MPL-2.0 components are distributed in executable form only. Their source code is available at the
locations above, and the license text is at https://mozilla.org/MPL/2.0/.

## Stream Deck plugin (`*.streamDeckPlugin`)

| Component | Version | License | Source |
|---|---|---|---|
| @elgato/streamdeck | 3.0.3 | MIT | https://github.com/elgatosf/streamdeck |
| @elgato/schemas | 0.5.3 | MIT | https://github.com/elgatosf/schemas |
| @elgato/utils | 0.6.1 | MIT | https://github.com/elgatosf/streamdeck |
| ws | 8.22.0 | MIT | https://github.com/websockets/ws |
| zod | 3.25.76 | MIT | https://github.com/colinhacks/zod |
| sdpi-components | 4.0.1 | MIT | https://github.com/GeekyEggo/sdpi-components |
| Lit (inside sdpi-components) | — | BSD-3-Clause | https://github.com/lit/lit |

## Plugin helper (`pcmonitor-helper.exe`)

| Component | Version | License | Source |
|---|---|---|---|
| SkiaSharp | 4.153.1 | MIT | https://github.com/mono/SkiaSharp |
| Skia (native library in SkiaSharp) | — | BSD-3-Clause | https://skia.org |
| .NET runtime | 10.0 | MIT | https://github.com/dotnet/runtime |

## Not included

The PawnIO driver, which is needed to read CPU temperature and motherboard fan sensors, is **not**
bundled. Users install it themselves from https://pawnio.eu.

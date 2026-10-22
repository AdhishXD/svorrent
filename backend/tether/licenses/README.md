# Android USB tethering dependencies

Svorrent's macOS helper uses the TetherKit 0.1.5 C interface and dynamically
links its `libtetherkit` and `libusb` libraries. The libraries were taken from
the [TetherKit v0.1.5 release](https://github.com/XiaoMiku01/TetherKit/releases/tag/v0.1.5)
(`TetherKit-v0.1.5-macos-arm64.zip`, SHA-256
`a27c011546eb6e37378d5a7680e882168763af9bfb18a237529033696ef8a566`).

- TetherKit is MIT licensed; see `TetherKit-MIT.txt` and its
  [source](https://github.com/XiaoMiku01/TetherKit/tree/v0.1.5).
- libusb is LGPL-2.1-or-later; see `libusb-LGPL-2.1.txt` and its
  [source](https://github.com/libusb/libusb/tree/v1.0.30).

The libraries remain separate shared libraries inside the app and the
privileged helper directory. Users may replace them with compatible versions.

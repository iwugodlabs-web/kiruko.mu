// Expo config plugin: work around the Xcode 26 / Apple Clang `fmt` consteval
// build failure on React Native (Expo SDK 52 / RN 0.76, which vendors fmt 11.0.2).
//
//   call to consteval function 'fmt::basic_format_string<...>' is not a
//   constant expression
//
// Why a SOURCE patch (not a -D define): fmt 11.0.2's include/fmt/base.h sets
// FMT_USE_CONSTEVAL *unconditionally* from its own compiler checks — there is
// NO `#ifndef FMT_USE_CONSTEVAL` guard — so a GCC_PREPROCESSOR_DEFINITIONS
// override is silently clobbered by the header. Under Xcode 26's Clang the
// header picks FMT_USE_CONSTEVAL=1, but that Clang then rejects fmt's
// compile-time format-string check. The only reliable fix is to flip the two
// `#define FMT_USE_CONSTEVAL 1` lines to 0 in the vendored source, so
// FMT_CONSTEVAL expands to nothing and fmt falls back to runtime validation.
// This applies to every consumer of the header (RCT-Folly, React-Core, …),
// which is where the consteval instantiation actually happens.
//
// Done in a Podfile post_install hook because this is a managed (no committed
// ios/) project — the Podfile is generated and pods are fetched on EAS.
// Remove once RN/Expo ship an fmt new enough to build under Xcode 26 unaided.
// See https://github.com/facebook/react-native/issues/55601
const { withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# >>> fmt-consteval-fix (Xcode 26)";

const SNIPPET = `
  ${MARKER}
  # fmt 11.0.2 base.h has no #ifndef guard around FMT_USE_CONSTEVAL, so a -D
  # override is ignored. Patch the source: force every branch to define 0.
  fmt_base = File.join(installer.sandbox.root, 'fmt', 'include', 'fmt', 'base.h')
  if File.exist?(fmt_base)
    fmt_src = File.read(fmt_base)
    fmt_patched = fmt_src.gsub('#  define FMT_USE_CONSTEVAL 1', '#  define FMT_USE_CONSTEVAL 0')
    if fmt_patched != fmt_src
      File.write(fmt_base, fmt_patched)
      Pod::UI.puts '[fmt-consteval-fix] forced FMT_USE_CONSTEVAL 0 in fmt/base.h (Xcode 26 workaround)'
    else
      Pod::UI.puts '[fmt-consteval-fix] no FMT_USE_CONSTEVAL=1 lines found (already patched or fmt changed)'
    end
  else
    Pod::UI.warn '[fmt-consteval-fix] fmt/base.h not found at ' + fmt_base.to_s
  end
  # <<< fmt-consteval-fix
`;

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    "ios",
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
      let contents = fs.readFileSync(podfile, "utf8");
      if (contents.includes(MARKER)) {
        return cfg; // idempotent
      }
      const anchor = /post_install do \|installer\|/;
      if (anchor.test(contents)) {
        contents = contents.replace(anchor, (m) => `${m}\n${SNIPPET}`);
      } else {
        // Expo prebuild always emits a post_install block; safety net.
        contents += `\npost_install do |installer|\n${SNIPPET}\nend\n`;
      }
      fs.writeFileSync(podfile, contents);
      return cfg;
    },
  ]);
};

import UnpluginTypia from "@typia/unplugin/rolldown";
import { defineConfig } from "tsdown";

export default defineConfig((inlineConfig, _context) => {
  const production = !inlineConfig.watch;

  return {
    outDir: "lib",
    exports: true,
    platform: "node",
    target: "node20",
    dts: production ? { build: true, oxc: true } : false,
    clean: production,
    format: ["esm", "cjs"],
    minify: production,
    sourcemap: !production,
    plugins: [UnpluginTypia({ cache: !production })],
  };
});

import UnpluginTypia from "@typia/unplugin/rolldown";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
    projects: [
      {
        test: {
          name: "Unit tests",
          include: ["test/**/*.test.ts"],
          benchmark: {
            include: ["bench/**/*.bench.ts"],
          },
        },
        plugins: [UnpluginTypia({ cache: true })],
      },
    ],
  },
});

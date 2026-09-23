import { defineConfig } from "@playwright/test";
import { sharedConfig } from "../../playwright.shared.mjs";

export default defineConfig({ ...sharedConfig, testDir: "./test/browser" });

// vite.config.ts の organSplit が content/organs.json から作るモジュール（形は src/content.ts の OrganCore と src/organ-details.ts）
declare module "virtual:organs-core" {
  const data: { organs: unknown[] };
  export default data;
}
declare module "virtual:organs-detail" {
  const data: { organs: unknown[] };
  export default data;
}

// vite.config.ts の define で入るアプリの版（src/app-version.ts）
declare const __APP_BUILD__: { commit: string; builtAt: string };

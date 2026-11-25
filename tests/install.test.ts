import { iosBrowser, iosDevice } from "../src/install";
import { isDeviceSetting } from "../src/db";
import { installGuide } from "../src/ui/install-guide";

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";
const IPAD_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.0.0 Mobile/15E148 Safari/604.1";
const IPHONE_LINE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/15.17.0";

/** 「ホーム画面に追加」の案内のページ（src/ui/install-guide.ts） */
describe("ホーム画面に追加の案内", () => {
  it("iPhone と iPad（Mac として名乗る iPadOS もタッチで）を見分ける", () => {
    expect(iosDevice(IPHONE_SAFARI, 5)).toBe("iphone");
    expect(iosDevice(IPAD_SAFARI, 5)).toBe("ipad");
    // タッチの無い Mac は iPad でない
    expect(iosDevice(IPAD_SAFARI, 0)).toBe("");
  });

  it("ブラウザを見分ける（LINE などアプリの中のページは、先に Safari で開いてもらう）", () => {
    expect(iosBrowser(IPHONE_SAFARI)).toBe("safari");
    expect(iosBrowser(IPHONE_CHROME)).toBe("chrome");
    expect(iosBrowser(IPHONE_LINE)).toBe("inapp");
  });

  it("飛ばしたことはこの端末だけ（同期しない）", () => {
    expect(isDeviceSetting("installGuideSkipped")).toBe(true);
  });

  it("手順は4つで、「ホーム画面に追加」と「追加」と、アイコンから開くことを伝え、iPhone と iPad を切り替えられる", () => {
    const page = installGuide();
    const steps = [...page.querySelectorAll(".ig-step")].map((step) => step.textContent ?? "");
    expect(steps).toHaveLength(4);
    expect(steps[1]).toContain("ホーム画面に追加");
    expect(steps[2]).toContain("追加");
    expect(steps[3]).toContain("アイコンから開いて");
    const ipad = [...page.querySelectorAll<HTMLButtonElement>(".ig-device .segment")].find((button) => button.textContent === "iPad")!;
    ipad.click();
    expect(page.querySelector(".ig-step")!.textContent).toContain("画面の上の右");
  });
});

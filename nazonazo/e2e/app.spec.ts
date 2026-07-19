import { expect, test } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const fixturePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'nazonazo_cheat.png');
const problemPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'mondai.png');

test('画像選択から解析結果まで進める', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '記号の画像を読み取る' })).toBeVisible();

  await page.getByRole('button', { name: '対応表を見る' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: '閉じる' }).click();

  await page.locator('#image-input').setInputFiles(fixturePath);
  await expect(page.getByRole('heading', { name: '読み取る範囲を合わせる' })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#corner-loading')).toBeHidden({ timeout: 60_000 });

  await page.getByRole('button', { name: '解析する' }).click();
  await expect(page.getByRole('heading', { name: '読み取り結果' })).toBeVisible();
  await expect(page.locator('#analysis-loading')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#output-text')).toBeVisible();
});

test('モバイル幅で横方向にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('実問題画像を3行のひらがなへ変換する', async ({ page }) => {
  await page.goto('/');
  await page.locator('#image-input').setInputFiles(problemPath);
  await expect(page.locator('#corner-loading')).toBeHidden({ timeout: 60_000 });
  await page.getByRole('button', { name: '解析する' }).click();
  await expect(page.locator('#analysis-loading')).toBeHidden({ timeout: 90_000 });
  await expect(page.locator('#output-text')).toHaveValue('ぱんはぱんでも\nたべられない\nぱんは？');
});

for (const rotation of [1, -1] as const) {
  const direction = rotation === 1 ? '右' : '左';
  test(`${direction}へ90度回転して保存された実問題画像も3行のひらがなへ変換する`, async ({ page }) => {
    await page.goto('/');
    const rotatedImage = await page.evaluate(async (quarterTurn) => {
      const image = new Image();
      image.src = '/mondai.png';
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalHeight;
      canvas.height = image.naturalWidth;
      const context = canvas.getContext('2d')!;
      if (quarterTurn === 1) {
        context.translate(canvas.width, 0);
        context.rotate(Math.PI / 2);
      } else {
        context.translate(0, canvas.height);
        context.rotate(-Math.PI / 2);
      }
      context.drawImage(image, 0, 0);
      return canvas.toDataURL('image/png').split(',')[1];
    }, rotation);

    await page.locator('#image-input').setInputFiles({
      name: `mondai-portrait-${direction}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from(rotatedImage, 'base64'),
    });
    await expect(page.locator('#corner-loading')).toBeHidden({ timeout: 60_000 });
    await page.getByRole('button', { name: '解析する' }).click();
    await expect(page.locator('#analysis-loading')).toBeHidden({ timeout: 90_000 });
    await expect(page.locator('#output-text')).toHaveValue('ぱんはぱんでも\nたべられない\nぱんは？');
  });
}

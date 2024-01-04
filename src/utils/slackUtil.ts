// slack関連util

/**
 * slackチャンネル名となる入力値をslackチャンネルに使用できる値に変換
 *
 * @param {string} originalChannelName - チャンネル名入力値
 * @returns 変換後チャンネル名
 */
export function convertChannelName(originalChannelName: string | null | undefined): string {
  if (!originalChannelName) {
    return "";
  }
  // ルール：大文字アルファベット（全角含む）不可、ハイフン、アンダースコア以外の記号不可、ラテン数字不可
  // 小文字変換、記号・空白変換、句読点変換
  return originalChannelName
    .toLowerCase()
    .replace(/[!"#$%&'()\*\+\-\.,\/:;<=>?@\[\\\]^_`{|}~\s]/g, "_")
    .replace(/、。/g, "_")
    .replace(/[Ⅰⅰ]/g, "1")
    .replace(/[Ⅱⅱ]/g, "2")
    .replace(/[Ⅲⅲ]/g, "3")
    .replace(/[Ⅳⅳ]/g, "4")
    .replace(/[Ⅴⅴ]/g, "5")
    .replace(/[_]$/g, "");
}

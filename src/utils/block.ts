import { PlainTextOption } from "@slack/bolt";

// Block Kit形式のselectBoxのoptions生成
export const createPlainTextOption = (list: { id: string; name: string }[]): PlainTextOption[] => {
  return list.map((value) => {
    return {
      text: {
        type: "plain_text",
        text: value.name,
      },
      value: value.name,
    };
  });
};

import {
  Block,
  BlockAction,
  KnownBlock,
  Middleware,
  SlackActionMiddlewareArgs,
  SlackShortcut,
  SlackShortcutMiddlewareArgs,
  SlackViewAction,
  SlackViewMiddlewareArgs,
  StaticSelectAction,
  View,
} from "@slack/bolt";
import { toPrettfiedJSONString } from "../utils/helpers";
import AssistantV2 from "ibm-watson/assistant/v2";
import { IamAuthenticator } from "ibm-watson/auth";
import { Configuration, OpenAIApi } from "openai";

const WATSON_NG = "解釈できませんでした。申し訳ありませんが違う表現を試していただけますか。";

// Watson AssistantのAPI資格情報
const assistant = new AssistantV2({
  version: "2023-06-15",
  authenticator: new IamAuthenticator({
    apikey: process.env.WATSON_ASSISTANT_API_KEY!,
  }),
  serviceUrl: process.env.WATSON_ASSISTANT_URL,
});

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

//#region Block Build
// 授業作成modal
export const buildAskQuestionModalView = (): View => {
  const blocks: (Block | KnownBlock)[] = [
    {
      type: "input",
      block_id: "firstQuestion",
      dispatch_action: true,
      element: {
        type: "static_select",
        placeholder: {
          type: "plain_text",
          text: "選択してください",
        },
        action_id: "selectFirstQuestion",
        options: [
          {
            text: {
              type: "plain_text",
              text: "意味を教えてほしい",
            },
            value: "1",
          },
          {
            text: {
              type: "plain_text",
              text: "使い方を教えてほしい",
            },
            value: "2",
          },
          {
            text: {
              type: "plain_text",
              text: "自由記述",
            },
            value: "3",
          },
        ],
      },
      label: {
        type: "plain_text",
        text: "概要",
      },
    },
    {
      type: "input",
      block_id: "secondQuestion",
      dispatch_action: true,
      element: {
        type: "static_select",
        placeholder: {
          type: "plain_text",
          text: "選択してください",
        },
        action_id: "selectSecondQuestion",
        options: [
          {
            text: {
              type: "plain_text",
              text: "Javaのコードの内容",
            },
            value: "1",
          },
          {
            text: {
              type: "plain_text",
              text: "Javaのエラーの内容",
            },
            value: "2",
          },
        ],
      },
      label: {
        type: "plain_text",
        text: "内容",
      },
    },
    {
      type: "input",
      block_id: "content",
      element: {
        type: "plain_text_input",
        action_id: "content",
        multiline: true,
        placeholder: {
          type: "plain_text",
          text: "質問したい単語やエラーメッセージを貼りつけてください",
        },
      },
      label: {
        type: "plain_text",
        text: "キーワードを入力",
      },
    },
  ];

  const modalView: View = {
    type: "modal",
    callback_id: "submitQuestion",
    title: {
      type: "plain_text",
      text: "質問",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: "実行",
      emoji: true,
    },
    close: {
      type: "plain_text",
      text: "キャンセル",
      emoji: true,
    },
    blocks,
  };

  return modalView;
};

// グローバルショートカット("new-question-request")の実行時に呼び出されるリスナー関数
export const newQuestionRequest: Middleware<SlackShortcutMiddlewareArgs<SlackShortcut>> = async ({
  client,
  body,
  ack,
}) => {
  try {
    await ack();

    const updateModalBlocks: (Block | KnownBlock)[] = buildAskQuestionModalView().blocks.filter((block) => {
      if (block.block_id === "secondQuestion" || block.block_id === "content") {
        return false;
      }
      return true;
    });

    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        ...buildAskQuestionModalView(),
        blocks: updateModalBlocks,
      },
    });
  } catch (err) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

// "selectFirstQuestion"の実行時に呼び出される関数
export const firstDropdownSelect: Middleware<SlackActionMiddlewareArgs<BlockAction<StaticSelectAction>>> = async ({
  ack,
  body,
  action,
  client,
}) => {
  try {
    await ack();

    const selectedValue = action.selected_option.value;
    const updateModalBlocks: (Block | KnownBlock)[] = buildAskQuestionModalView().blocks.filter((block) => {
      if ((selectedValue === "1" || selectedValue === "2") && block.block_id === "content") {
        return false;
      }
      if (selectedValue === "3" && block.block_id === "secondQuestion") {
        return false;
      }
      return true;
    });

    await client.views.update({
      view_id: body.view?.id,
      view: {
        ...buildAskQuestionModalView(),
        blocks: updateModalBlocks,
      },
    });
  } catch (err) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

// "selectSecondQuestion"の実行時に呼び出される関数
export const secondDropdownSelect: Middleware<SlackActionMiddlewareArgs<BlockAction<StaticSelectAction>>> = async ({
  ack,
  body,
  client,
}) => {
  try {
    await ack();

    await client.views.update({
      view_id: body.view?.id,
      view: buildAskQuestionModalView(),
    });
  } catch (err) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

/**
 * 質問の実行ボタンをおしたときの処理
 */
export const submitQuestionRequest: Middleware<SlackViewMiddlewareArgs<SlackViewAction>> = async ({
  ack,
  view,
  client,
  body,
}) => {
  try {
    await ack();

    const result = await client.chat.postMessage({
      channel: body.user.id,
      text: "結果が表示されるまで少々お待ちください。",
    });

    const values = view.state.values;
    const question = values.content.content.value ?? "";
    const answer = await getAnswer(question);

    await client.chat.delete({
      channel: body.user.id,
      ts: result.ts!,
    });

    await client.chat.postMessage({
      channel: body.user.id,
      text: answer,
    });
  } catch (err) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

/**
 * APIから質問に対する回答を取得する
 * @param question
 * @returns
 */
async function getAnswer(question: string): Promise<string> {
  let sessionId;
  if (!sessionId) {
    const sessionResponse = await assistant.createSession({
      assistantId: process.env.WATSON_ASSISTANT_ID || "",
    });
    sessionId = sessionResponse.result.session_id;
  }

  console.log("request to watson");
  const watsonResponse = await assistant.message({
    assistantId: process.env.WATSON_ASSISTANT_ID || "",
    sessionId: sessionId,
    input: {
      message_type: "text",
      text: question,
    },
  });

  // Watson Assistantからの応答を取得
  const output = watsonResponse.result.output.generic;
  if (output && output.length > 0) {
    const genericResponses = output.filter((item: any) => item.response_type === "text");
    const response = genericResponses.map((item: any) => item.text).join(" ");
    if (response === WATSON_NG) {
      console.log("request to watson failed");
      return extractChatGpt(question);
    } else {
      console.log("request to watson successful");
      return response;
    }
  } else {
    console.log("request to chatGPT");
    return extractChatGpt(question);
  }
}

/**
 * chatGPTから応答を取得
 * @param question
 */
async function extractChatGpt(question: string): Promise<string> {
  const response = await openai.createChatCompletion({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "user",
        content: `以下のことについて教えてください。日本語で回答をお願いします。${question}`,
      },
    ],
  });

  if (!response.data || !response.data.choices || !response.data.choices[0].message?.content) {
    return "失敗しました。再度試してください。";
  } else {
    return response.data.choices[0].message?.content;
  }
}

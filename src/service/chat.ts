import { Middleware, SlackEventMiddlewareArgs } from "@slack/bolt";
import { Configuration, OpenAIApi } from "openai";
import AssistantV2 from "ibm-watson/assistant/v2";
import { IamAuthenticator } from "ibm-watson/auth";

const WATSON_NG = "解釈できませんでした。申し訳ありませんが違う表現を試していただけますか。";

if (!process.env.WATSON_ASSISTANT_API_KEY) {
  throw new Error("Watson Assistant API key is not set.");
}

// Watson AssistantのAPI資格情報
const assistant = new AssistantV2({
  version: "2023-06-15",
  authenticator: new IamAuthenticator({
    apikey: process.env.WATSON_ASSISTANT_API_KEY,
  }),
  serviceUrl: process.env.WATSON_ASSISTANT_URL,
});

const configuration = new Configuration({
  apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

/**
 * 質問取得、回答送信
 */
export const handleMessage: Middleware<SlackEventMiddlewareArgs<"message">> = async ({ event, client, say }) => {
  try {
    const channelInfo = await client.conversations.info({
      channel: event.channel,
    });
    const channelMembers = await client.conversations.members({
      channel: event.channel,
    });
    //アプリチャンネル以外でのメッセージイベントは何もしない
    if (!channelInfo.channel?.is_im || !channelMembers.members?.includes(process.env.SLACK_APP_CHANNEL!)) {
      console.log("Question function not allowed");
      return;
    }
    // メッセージ取得
    const slackResponse = await client.conversations.replies({
      channel: event.channel,
      ts: event.event_ts,
    });
    const message = slackResponse.messages ?? [];
    const question = message[0].text;
    const answer = await getAnswer(question ?? "");

    say(answer);
  } catch (e) {
    console.log(e);
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
        content: `以下の質問に対して日本語で回答をお願いします。${question}`,
      },
    ],
  });

  if (!response.data || !response.data.choices || !response.data.choices[0].message?.content) {
    return "失敗しました。再度試してください。";
  } else {
    return response.data.choices[0].message?.content;
  }
}

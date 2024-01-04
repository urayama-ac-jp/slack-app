/* eslint-disable no-console */
/* eslint-disable import/no-internal-modules */
import {
  App,
  LogLevel,
  View,
  ExpressReceiver,
  Middleware,
  SlackShortcutMiddlewareArgs,
  SlackShortcut,
  SlackViewMiddlewareArgs,
  SlackViewAction,
  KnownBlock,
  Block,
} from "@slack/bolt";
import "../utils/env";
import { toPrettfiedJSONString } from "../utils/helpers";
import { convertChannelName } from "../utils/slackUtil";
import { writeAsignmentData } from "../libs/spreadsheet";

const boltReceiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET!, endpoints: "/" });
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.DEBUG,
  receiver: boltReceiver,
});

//#region Block Build
// 課題モーダル
function buildAsignmentModalView(): View {
  return {
    type: "modal",
    callback_id: "submitAsignment",
    title: {
      type: "plain_text",
      text: "課題登録",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: "登録",
      emoji: true,
    },
    close: {
      type: "plain_text",
      text: "キャンセル",
      emoji: true,
    },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "Github Classroomで作成した課題URLを入力してください。",
        },
      },
      {
        type: "divider",
      },
      {
        type: "input",
        block_id: "lesson",
        label: {
          type: "plain_text",
          text: "授業選択",
        },
        element: {
          action_id: "selectLesson",
          type: "conversations_select",
          default_to_current_conversation: true,
          placeholder: {
            type: "plain_text",
            text: "チャンネル一覧から授業を選択",
          },
          filter: {
            include: ["public", "private"],
            exclude_bot_users: true,
          },
        },
      },
      {
        type: "input",
        block_id: "name",
        element: {
          type: "plain_text_input",
          action_id: "inputName",
        },
        label: {
          type: "plain_text",
          text: "課題名",
          emoji: true,
        },
      },
      {
        type: "input",
        block_id: "url",
        element: {
          type: "plain_text_input",
          action_id: "inputURL",
        },
        label: {
          type: "plain_text",
          text: "課題URL",
          emoji: true,
        },
      },
    ],
  };
}

function buildNewAsignmentInfo(asignmentName: string, asignmentURL: string): (KnownBlock | Block)[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `\n\n:new: *新しい課題のおしらせ* :new:\n\n下記のURLからアクセスし、課題に取り組んでください。\n\n質問はこちらのチャンネルにどうぞ！`,
      },
    },
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `:memo: *課題名*\n\n${asignmentName}\n\n\n:memo: *課題URL*\n\n ${asignmentURL}`,
      },
    },
  ];
}
//#endregion

// グローバルショートカット("new-lesson-request")の実行時に呼び出されるリスナー関数
export const newAsignmentRequest: Middleware<SlackShortcutMiddlewareArgs<SlackShortcut>> = async ({
  logger,
  client,
  body,
  ack,
}) => {
  await ack();
  const res = await client.views.open({
    trigger_id: body.trigger_id,
    view: buildAsignmentModalView(),
  });
  logger.info("views.open response:\n\n" + toPrettfiedJSONString(res) + "\n");
};

/**
 * 課題の登録ボタンをおしたときの処理
 */
export const submitAsignmentRequest: Middleware<SlackViewMiddlewareArgs<SlackViewAction>> = async ({
  ack,
  view,
  context,
}) => {
  try {
    // 1. チャンネル作成
    const values = view.state.values;

    const lessonChannel = values.lesson?.selectLesson?.selected_conversation;
    const asignmentName = values.name?.inputName?.value ?? "";
    const asignmentURL = values.url?.inputURL?.value ?? "";

    // バリデーション
    const errors: { [key: string]: string } = {};
    if (!asignmentName || asignmentName.length > 80) {
      errors["name"] = "課題名は 80 文字以内で入力してください";
    }
    const reg = new RegExp("https://classroom.github.com/");
    if (!asignmentURL || !reg.test(asignmentURL)) {
      errors["url"] = "Github Classroom で作成した課題URLを入力してください";
    }
    if (Object.entries(errors).length > 0) {
      // モーダル内に対応するエラーメッセージを表示します
      await ack({
        response_action: "errors",
        errors: errors,
      });
      return;
    }

    // モーダルを閉じる
    await ack();

    // 課題チャンネル名を作成
    let asignmentChannelName = convertChannelName(asignmentName);
    const lessonChannelName = await app.client.conversations.info({
      token: context.botToken,
      channel: lessonChannel!,
    });
    asignmentChannelName = `${lessonChannelName.channel?.name}_${asignmentChannelName}`; // 課題チャンネル名：授業名_課題名

    // Call conversations.create
    const resultAsignmentCreate = await app.client.conversations.create({
      token: context.botToken,
      name: asignmentChannelName,
    });
    const createdChannel = resultAsignmentCreate.channel ? resultAsignmentCreate.channel.id : "";
    console.log("createdChannel: ", createdChannel);

    // 2. 作成した授業チャンネルに招待（学生と本人）
    // // Call conversations.members 選択したlessonチャンネルのユーザーを取得
    const resultLessonChannelUser = await app.client.conversations.members({
      token: context.botToken,
      channel: lessonChannel ? lessonChannel : "",
    });
    const bot = context.botUserId || "";
    const inviteUsers = resultLessonChannelUser?.members?.filter((v) => v !== bot) ?? [];

    // Call conversations.invite
    await app.client.conversations.invite({
      token: context.botToken,
      channel: createdChannel!,
      users: inviteUsers.join(","),
    });

    // 3. 新しく作られた課題チャンネルに課題URLの配布
    await app.client.chat.postMessage({
      token: context.botToken,
      channel: createdChannel ? createdChannel : "",
      blocks: buildNewAsignmentInfo(asignmentName, asignmentURL),
    });

    // 4. スプレッドシートに作成した課題情報（チャンネル、学生など）登録
    await writeAsignmentData(
      process.env.LESSON_SHEET_ID!,
      lessonChannel!,
      asignmentChannelName,
      createdChannel!,
      asignmentURL!
    );
  } catch (err) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

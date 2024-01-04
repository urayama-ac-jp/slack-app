import {
  Middleware,
  SlackShortcut,
  SlackShortcutMiddlewareArgs,
  SlackViewAction,
  SlackViewMiddlewareArgs,
  View,
} from "@slack/bolt";
import { findSheet, getAllSheets } from "../libs/spreadsheet";

export const SERVICE_ID = "submitSelectAsignmentRequest";
const BLOCK_ID = `${SERVICE_ID}Block`;
const ACTION_ID = `${SERVICE_ID}Action`;

type Asignment = {
  repo: string;
  username: string;
  tests: string;
  failures: string;
  ignored: string;
  successRate: string;
  date: string;
  sha: string;
};

//#region Block Build

function buildProgressSection(data: Asignment) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `\`${data.repo}\`: \n:white_check_mark: ${data.tests} :no_entry: ${data.failures} :waving_white_flag: ${data.ignored} :hourglass_flowing_sand: ${data.successRate}"`,
    },
    accessory: {
      type: "button",
      text: {
        type: "plain_text",
        text: "準備中...",
        emoji: true,
      },
    },
  };
}

function buildProgressContext(data: Asignment) {
  return {
    type: "context",
    elements: [
      {
        text: `_${data.username}_ ${data.date}`,
        type: "mrkdwn",
      },
    ],
  };
}

function buildProgressHeader(sheetName: string) {
  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: `:runner: *${sheetName}* :runner:`,
    },
  };
}

function buildTitle() {
  return {
    type: "header",
    text: {
      type: "plain_text",
      text: ":newspaper:  進捗状況  :newspaper:",
    },
  };
}

function buildSubTitle() {
  const now = new Date();
  return {
    type: "context",
    elements: [
      {
        text: `*${now.toLocaleDateString()} ${now.toLocaleTimeString()}*  |  現在の最新進捗`,
        type: "mrkdwn",
      },
    ],
  };
}

function buildDivider() {
  return {
    type: "divider",
  };
}

function buildLessons(sheetMap: Map<string, Asignment[]>): any[] {
  const ret = [];
  for (const [sheetName, sheetData] of sheetMap.entries()) {
    const lessonSheet = sheetData.map((data) => [buildProgressSection(data), buildProgressContext(data)]).flat();

    ret.push(buildProgressHeader(sheetName), ...lessonSheet);
  }
  return ret;
}

function buildFooter() {
  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: ":pushpin: 詳細を見るとさらに細かいデータが確認できます",
      },
    ],
  };
}

//#endregion

async function fetchSheetLessons(sheetId: string): Promise<Map<string, Asignment[]>> {
  const sheets = await getAllSheets(sheetId!);
  const asignmentSheets = sheets.filter((sheet) => sheet !== "学生" && sheet !== "成績");

  const ret = new Map();
  for (const sheetName of asignmentSheets) {
    const sheetData = (await findSheet(sheetId, sheetName)) as Asignment[];
    ret.set(sheetName, sheetData);
  }

  return ret;
}

export const submitSelectAsignmentRequest: Middleware<SlackViewMiddlewareArgs<SlackViewAction>> = async (args) => {
  // console.debug("submitSelectAsignmentRequest", JSON.stringify(args, undefined, "  "))
  const { payload, ack, client, body, context, view } = args;
  await ack();

  const sheetId = view.state.values[BLOCK_ID][ACTION_ID].selected_option!.value!;
  const sheetMap = await fetchSheetLessons(sheetId);

  const blocks = [
    buildTitle(),
    buildSubTitle(),
    buildDivider(),
    ...buildLessons(sheetMap),
    buildDivider(),
    buildFooter(),
  ];

  await client.chat.postEphemeral({
    user: body.user.id,
    channel: body.user.id,
    blocks,
  });
};

// グローバルショートカット("new-lesson-request")の実行時に呼び出されるリスナー関数
export const selectAsignmentRequest: Middleware<SlackShortcutMiddlewareArgs<SlackShortcut>> = async (args) => {
  const { logger, client, body, ack } = args;
  // logger.info("selectAsignmentRequest", JSON.stringify(args, undefined, "  "))
  await ack();

  const lessonSheet = await findSheet(process.env.LESSON_SHEET_ID!, "lesson");

  //  進捗一覧取得モーダルを開く
  // FIXME builder化は後回し
  const asignmentCreateModalView: View = {
    type: "modal",
    callback_id: SERVICE_ID,
    title: {
      type: "plain_text",
      text: "進捗を見る",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: "確認する",
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
          text: "今日の進捗一覧を確認します",
        },
      },
      {
        type: "input",
        block_id: BLOCK_ID,
        label: {
          type: "plain_text",
          text: "授業",
          emoji: true,
        },
        element: {
          type: "static_select",
          placeholder: {
            type: "plain_text",
            text: "確認したい授業",
            emoji: true,
          },
          options: lessonSheet.map((sheet) => ({
            text: {
              type: "plain_text",
              text: sheet["授業名"],
              emoji: true,
            },
            // FIXME 本来は秘密情報なので、クライアントに渡してはいけないけどごめんね。
            value: sheet["spreadsheet ID"],
          })),
          action_id: ACTION_ID,
        },
      },
    ],
  };
  logger.info(asignmentCreateModalView);

  const res = await client.views.open({
    trigger_id: body.trigger_id,
    view: asignmentCreateModalView,
  });
  logger.info("views.open response:\n\n" + res + "\n");
};

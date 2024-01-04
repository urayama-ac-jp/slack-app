/* eslint-disable no-console */
/* eslint-disable import/no-internal-modules */
import {
  App,
  LogLevel,
  PlainTextOption,
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
import { Member } from "@slack/web-api/dist/response/UsersListResponse";
import "../utils/env";
import { toPrettfiedJSONString } from "../utils/helpers";
import { makeUnregisteredLessonList } from "../utils/sheetUtil";
import { convertChannelName } from "../utils/slackUtil";
import { createPlainTextOption } from "../utils/block";
import {
  addFileParent,
  copySheet,
  createSheet,
  createSpreadsheet,
  findSheetIdByIndex,
  findSheetIdByTitle,
  permissionCreate,
  readLessons,
  readSheet,
  readStudentsFromLessonMst,
  renameSheet,
  writeLessonChannel,
  writeSheet,
} from "../libs/spreadsheet";

// google account
const GOOGLE_ACCOUNT = "github@urayama.ac.jp";
// 授業マスタ 各シート情報
const SHEET_NAME_STUDENT = "学生";
const SHEET_NAME_SCORE = "成績";
const SHEET_NAME_ASIGNMENTS = "課題一覧";
const SHEET_ASIGNMENTS_CELLS_HEADER = [["課題", "channelID", "課題URL"]]; // A1: 課題, B1：channelID, C1: 課題URL に相当

// 授業シート（各授業ごとに生成されるスプレッドシート）
const LESSON_SPREADSHEET_PREFIX = "授業シート_";

const boltReceiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET!, endpoints: "/" });
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.DEBUG,
  receiver: boltReceiver,
});

//#region Block Build
// 授業作成modal
export const buildRegistLessonModalView = (options: PlainTextOption[]): View => {
  const input: KnownBlock = {
    type: "input",
    block_id: "lesson",
    element: {
      type: "static_select",
      placeholder: {
        type: "plain_text",
        text: "授業を選択してください",
        emoji: true,
      },
      action_id: "selectLesson",
      options,
    },
    label: {
      type: "plain_text",
      text: "授業",
      emoji: true,
    },
  };

  const blocks: (Block | KnownBlock)[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "slack授業チャンネル作成",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "セレクトボックスからslackに取り込みたい授業を選択してください。",
      },
    },
  ];
  if (options.length !== 0) {
    blocks.push(input);
  }

  const modalView: View = {
    type: "modal",
    callback_id: "submitLesson",
    title: {
      type: "plain_text",
      text: "授業作成",
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
    blocks,
  };

  return modalView;
};

function buildNewMasterInfo(lessonName: string, spreadsheetId: string): (KnownBlock | Block)[] {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: ":bulb: *マスタURLのご案内*\n\n授業の情報が記載されているシートURLです。\n成績や進捗はこちらのシートからご覧ください。",
      },
    },
    {
      type: "divider",
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${lessonName}*\n\nhttps://docs.google.com/spreadsheets/d/${spreadsheetId}\n\n`,
      },
    },
    {
      type: "divider",
    },
  ];
}
//#endregion

// グローバルショートカット("new-lesson-request")の実行時に呼び出されるリスナー関数
export const newLessonRequest: Middleware<SlackShortcutMiddlewareArgs<SlackShortcut>> = async ({
  client,
  body,
  ack,
}) => {
  try {
    // ここで Slack からのリクエストを受け付けて 200 OK をすぐに返す
    await ack();

    // 3秒ルールのため、先にselectBoxが空のモーダルをopen
    // 授業作成モーダル（初期）
    const initRegistLessonModalView: View = buildRegistLessonModalView([]);
    const res = await client.views.open({
      trigger_id: body.trigger_id,
      view: initRegistLessonModalView,
    });

    // spreadsheetから授業リスト取得
    const sheetLessons = await readLessons(process.env.LESSON_SHEET_ID!);
    const options: PlainTextOption[] = createPlainTextOption(makeUnregisteredLessonList(sheetLessons));

    // 授業取得後のmodalにupdate
    const lessonCreateModalView: View = buildRegistLessonModalView(options);
    await client.views.update({
      view_id: res.view?.id,
      view: lessonCreateModalView,
    });
  } catch (err: any) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

/**
 * 授業を登録ボタンをおしたときの処理
 */
export const submitLessonRequest: Middleware<SlackViewMiddlewareArgs<SlackViewAction>> = async ({
  ack,
  body,
  view,
  context,
}) => {
  try {
    const lessonMstSpreadsheetId = process.env.LESSON_SHEET_ID!;

    // 1. チャンネル作成
    const values = view.state.values;
    const lessonId = values["lesson"] ? values["lesson"].selectLesson.selected_option?.value : "";
    const resultReadLessons = await readLessons(lessonMstSpreadsheetId);
    const lessonList = resultReadLessons ? resultReadLessons : [];
    const lessonOptions = makeUnregisteredLessonList(lessonList);
    let lessonName = lessonOptions.find((lesson) => {
      return lesson.id === lessonId;
    })?.name;

    // LessonNameチェックと変換
    const errors: { [key: string]: string } = {};
    if (!lessonName) {
      errors["lesson"] = "授業は必須項目です";
      // モーダル内に対応するエラーメッセージを表示します
      await ack({
        response_action: "errors",
        errors,
      });
      return;
    }
    const convertedLessonName = convertChannelName(lessonName);

    // 入力内容に問題がなかったので空のボディで 200 OK を返してモーダルを閉じる
    await ack();

    // Call conversations.create
    const resultChannelCreate = await app.client.conversations.create({
      token: context.botToken,
      name: convertedLessonName,
    });
    if (!resultChannelCreate.channel) {
      // TODO: チャンネル作成できなかった場合のエラーハンドリング
      throw new Error();
    }
    const createdChannel = resultChannelCreate.channel ? resultChannelCreate.channel.id : "";

    // spreadsheetから選択した授業のspreadSheetId取得
    //const selectedLessonSheet = await findChannelSpreadsheetId(sheetId, lessonName);
    // if (selectedLessonSheet === "") {
    //   // TODO: ""が返ってきたときの処理
    //   throw new Error();
    // }

    // 2. 作成した授業チャンネルに招待（学生と本人）
    const slackUsers = await app.client.users.list({
      token: context.botToken,
    });

    const submitUser = body.user.id; // 作成者のslackId
    // 授業履修学生のemail取得
    // const studentEmails = await readStudents(selectedLessonSheet);
    const studentEmails = await readStudentsFromLessonMst(lessonMstSpreadsheetId, lessonName);
    const studentIds = slackUsers.members?.reduce((ids: string[], member: Member) => {
      const email = member.profile?.email;
      if (!!email && studentEmails.some((v: string) => v === email)) {
        return [...ids, member.id!];
      }
      return ids;
    }, []);
    console.log("inviteStudentEmails", studentEmails);
    console.log("inviteStudentId", studentIds);

    // Call conversations.invite
    await app.client.conversations.invite({
      token: context.botToken,
      channel: createdChannel!,
      users: [submitUser, ...studentIds!].join(","),
    });

    // 3. 授業シートURLを作成者に通知
    // DM open
    const submitUserEmail = slackUsers.members?.find((member) => member.id === submitUser)?.profile?.email;

    // シート作成
    const createLessonSpreadsheet = await createSpreadsheet(LESSON_SPREADSHEET_PREFIX + lessonName); // 授業シート_lessonName
    if (!createLessonSpreadsheet) {
      // TODO シートを作成できなかったときの処理
    }
    await editNewLessonSpreadsheet(lessonMstSpreadsheetId, createLessonSpreadsheet, lessonName, submitUserEmail!);

    await app.client.conversations.open({
      token: context.botToken,
      users: submitUser,
    });
    // DMに送信
    await app.client.chat.postEphemeral({
      channel: createdChannel!,
      user: submitUser,
      blocks: buildNewMasterInfo(lessonName, createLessonSpreadsheet),
    });

    // 4. スプレッドシートに作成した授業情報登録
    // channel idをspreadsheetに書き込み
    const result = await writeLessonChannel(
      lessonMstSpreadsheetId,
      lessonName,
      createdChannel!,
      submitUser,
      createLessonSpreadsheet
    );
    if (!result) {
      // TODO: シートに書き込み失敗した場合の処理
      throw new Error();
    }
  } catch (err) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

/**
 * 新規作成シートを授業シート用に編集
 *
 * @param {string} lessonMstSpreadsheetId - 授業マスタspreadsheetID
 * @param { string } newSpreadsheetId - 新規作成済みのspreadsheetID
 * @param { string } lessonName - 授業名
 * @param { string } email - 教師（操作中のユーザー）のemail
 * @returns 新規作成した授業シートのspreadsheetID
 */
const editNewLessonSpreadsheet = async (
  lessonMstSpreadsheetId: string,
  newSpreadsheetId: string,
  lessonName: string,
  email: string
): Promise<string> => {
  try {
    // デフォルトシート 権限付与
    await permissionCreate(newSpreadsheetId, email, "writer"); // 権限：writerは編集者
    await permissionCreate(newSpreadsheetId, GOOGLE_ACCOUNT, "writer");

    // デフォルトシート フォルダ移動
    await addFileParent(newSpreadsheetId, process.env.LESSON_DRIVE_ID!);

    // デフォルトシート名rename
    await renameSheet(newSpreadsheetId, 0, SHEET_NAME_STUDENT); // デフォルトですでに用意されているシートのindexは0

    // 授業シート：学生情報転載（授業マスタからコピー）
    const studentValues = await readSheet(lessonMstSpreadsheetId, lessonName);
    await writeSheet(newSpreadsheetId, SHEET_NAME_STUDENT, studentValues);

    // 授業シート：課題シート作成
    await createSheet(newSpreadsheetId, SHEET_NAME_ASIGNMENTS); // 課題シートのindexは1
    await writeSheet(newSpreadsheetId, SHEET_NAME_ASIGNMENTS, SHEET_ASIGNMENTS_CELLS_HEADER);

    // 授業シート：成績シート作成（授業マスタからコピー）
    const sheetId = await findSheetIdByTitle(lessonMstSpreadsheetId, SHEET_NAME_SCORE);
    if (sheetId === -1) {
      // TODO 授業マスタで成績シートがみつからなかった時
      return newSpreadsheetId;
    }
    await copySheet(lessonMstSpreadsheetId, sheetId, newSpreadsheetId);
    const newSheetId = await findSheetIdByIndex(newSpreadsheetId, 2); // コピーされた成績シートのindexは2
    await renameSheet(newSpreadsheetId, newSheetId, SHEET_NAME_SCORE);

    return newSpreadsheetId;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
};

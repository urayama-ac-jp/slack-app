/* eslint-disable no-console */
/* eslint-disable import/no-internal-modules */
import "./utils/env";
import { App, LogLevel, ExpressReceiver, Middleware, SlackEventMiddlewareArgs } from "@slack/bolt";

import express from "express";
import bodyParser from "body-parser";
import { newLessonRequest, submitLessonRequest } from "./service/registLesson";
import { newAsignmentRequest, submitAsignmentRequest } from "./service/registAsignment";
import { appHomeOpenedRequest } from "./service/appHome";
import {
  selectAsignmentRequest,
  submitSelectAsignmentRequest,
  SERVICE_ID as SELECT_ASIGNMENT_SERVICE_ID,
} from "./service/selectAsignmentRequest";
import { githubExam } from "./service/express/";
import { handleMessage } from "./service/chat";
import { newTeamRequest, submitTeamRequest } from "./service/createTeamChannel";
import {
  firstDropdownSelect,
  newQuestionRequest,
  secondDropdownSelect,
  submitQuestionRequest,
} from "./service/askQuestion";

const exp = express();
const boltReceiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET!, endpoints: "/" });
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.DEBUG,
  receiver: boltReceiver,
});

app.use(async ({ next }) => {
  // TODO: This can be improved in future versions
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  await next!();
});

// 授業登録：グローバルショートカット("new-lesson-request")の実行時に呼び出されるリスナー関数
app.shortcut("new-lesson-request", newLessonRequest);
// 授業を登録ボタンをおしたときの処理
app.view("submitLesson", submitLessonRequest);

// 課題登録：グローバルショートカット("new-asignment-request")の実行時に呼び出されるリスナー関数
app.shortcut("new-asignment-request", newAsignmentRequest);
// 課題を登録ボタンをしたときの処理
app.view("submitAsignment", submitAsignmentRequest);

// 進捗一覧取得：グローバルショートカット("select-asignments")の実行時に呼び出されるリスナー関数
app.shortcut("select-asignments", selectAsignmentRequest);
app.view(SELECT_ASIGNMENT_SERVICE_ID, submitSelectAsignmentRequest);

// チームチャンネル作成：グローバルショートカット("new-team-request")の実行時に呼び出されるリスナー関数
app.shortcut("new-team-request", newTeamRequest);
// チームチャンネルの作成ボタンをおしたときの処理
app.view("submitTeam", submitTeamRequest);

// 質問：グローバルショートカット("new-question-request")の実行時に呼び出されるリスナー関数
app.shortcut("new-question-request", newQuestionRequest);
// 質問の実行ボタンをおしたときの処理
app.view("submitQuestion", submitQuestionRequest);

// 授業選択セレクトボックスを選択したときのaction
app.action("selectChannel", async ({ ack }) => {
  await ack();
});

// ユーザーが App Home にアクセスしたことを伝えるイベントをリッスン
app.event("app_home_opened", appHomeOpenedRequest);

app.message(handleMessage as Middleware<SlackEventMiddlewareArgs<"message">>);

// 質問選択ドロップダウンを選択したときのaction
app.action("selectFirstQuestion", firstDropdownSelect);

app.action("selectSecondQuestion", secondDropdownSelect);

exp.disable("x-powered-by");
exp.use(function (req: any, res: any, next: any) {
  res.setHeader("robots", "noindex");
  next();
});

exp.use(`/slack/events`, boltReceiver.router);
exp.use(bodyParser.urlencoded({ extended: true }));
exp.use(bodyParser.json());

exp.get("/", (_req, res) => res.send("Hello World!"));
exp.post("/github/exam", githubExam);

exp.listen(Number(process.env.PORT) || 3000, () => console.log("⚡️ Bolt app is running!"));

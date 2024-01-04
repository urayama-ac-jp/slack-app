import {
  App,
  Block,
  ExpressReceiver,
  KnownBlock,
  LogLevel,
  Middleware,
  PlainTextOption,
  SectionBlock,
  SlackShortcut,
  SlackShortcutMiddlewareArgs,
  SlackViewAction,
  SlackViewMiddlewareArgs,
  View,
} from "@slack/bolt";
import { toPrettfiedJSONString } from "../utils/helpers";
import { findTeamList, readStudensInfo } from "../libs/spreadsheet";
import { makeTeamList } from "../utils/sheetUtil";
import { TEACHER_CHANNEL_NAME } from "./appHome";

const boltReceiver = new ExpressReceiver({ signingSecret: process.env.SLACK_SIGNING_SECRET!, endpoints: "/" });
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  logLevel: LogLevel.DEBUG,
  receiver: boltReceiver,
});

//#region Block Build
// チームチャンネル作成モーダル
function buildCreateTeamChannelModalView(teamOptions: SectionBlock[], teacherOptions: PlainTextOption[]): View {
  const input: KnownBlock = {
    type: "input",
    block_id: "teacher",
    element: {
      type: "multi_static_select",
      action_id: "selectTeacher",
      placeholder: {
        type: "plain_text",
        text: "追加する教師を選択してください。",
      },
      options: teacherOptions,
    },
    label: {
      type: "plain_text",
      text: "教師",
      emoji: true,
    },
  };

  const blocks: (Block | KnownBlock)[] = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "チームチャンネル作成",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "以下のチームチャンネルを作成します。",
      },
    },
    ...teamOptions,
  ];

  if (teacherOptions.length) {
    blocks.push(input);
  }

  const modalView: View = {
    type: "modal",
    callback_id: "submitTeam",
    title: {
      type: "plain_text",
      text: "チームチャンネル作成",
      emoji: true,
    },
    submit: {
      type: "plain_text",
      text: "作成",
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
}

// グローバルショートカット("new-team-request")の実行時に呼び出されるリスナー関数
export const newTeamRequest: Middleware<SlackShortcutMiddlewareArgs<SlackShortcut>> = async ({
  client,
  body,
  context,
  ack,
}) => {
  try {
    await ack();

    const initCreateTeamChannelModalView: View = buildCreateTeamChannelModalView([], []);
    const res = await client.views.open({
      trigger_id: body.trigger_id,
      view: initCreateTeamChannelModalView,
    });

    // spreadsheetからチームリスト取得
    const sheetTeams = await findTeamList(process.env.LESSON_SHEET_ID!);
    const teamList = makeTeamList(sheetTeams);
    const teamOptions = [];
    for (const team of teamList) {
      const option: SectionBlock = {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `・ ${team}`,
        },
      };
      teamOptions.push(option);
    }

    // 教師用チャンネルから教師一覧取得
    const conversasionsListResponse = await client.conversations.list({
      token: context.botToken,
      types: "public_channel,private_channel",
    });
    const channels = conversasionsListResponse.channels ?? [];
    const teacherChannel = channels.find((v) => v.name === TEACHER_CHANNEL_NAME);
    const channelMembers = await client.conversations.members({
      token: context.botToken,
      channel: teacherChannel?.id ?? "",
    });
    const members = channelMembers.members ?? [];
    const teacherOptions = [];
    for (const member of members) {
      const userInfo = await client.users.info({ user: member });
      const option: PlainTextOption = {
        text: {
          type: "plain_text",
          text: userInfo.user?.real_name ?? "",
        },
        value: userInfo.user?.id,
      };
      teacherOptions.push(option);
    }

    // modalにupdate
    const teamChannelCreateModalView: View = buildCreateTeamChannelModalView(teamOptions, teacherOptions);
    await client.views.update({
      view_id: res.view?.id,
      view: teamChannelCreateModalView,
    });
  } catch (err: any) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

/**
 * チームチャンネルの作成ボタンをおしたときの処理
 */
export const submitTeamRequest: Middleware<SlackViewMiddlewareArgs<SlackViewAction>> = async ({
  ack,
  view,
  context,
  client,
}) => {
  try {
    const values = view.state.values;
    const selectedOptions = values["teacher"] ? values["teacher"].selectTeacher.selected_options : [];
    const selectedTeacher = selectedOptions?.map((option) => option.value);

    // 1. チャンネル作成
    const sheetTeams = await findTeamList(process.env.LESSON_SHEET_ID!);
    const teamList = makeTeamList(sheetTeams);

    const conversasionsListResponse = await client.conversations.list({
      token: context.botToken,
      types: "public_channel,private_channel",
    });

    const channels = conversasionsListResponse.channels ? conversasionsListResponse.channels.map((v) => v.name) : [];
    const duplicateChannel = teamList.filter((team) => channels.includes(team));

    if (duplicateChannel.length) {
      const initFailedCreateTeamChannelModalView: View = buildFailedCreateTeamChannelModalView(duplicateChannel);
      await ack({
        response_action: "update",
        view: initFailedCreateTeamChannelModalView,
      });
      return;
    }

    const slackUsers = await app.client.users.list({
      token: context.botToken,
    });
    const sheetStudents = await readStudensInfo(process.env.LESSON_SHEET_ID!);

    await ack();

    for (const team of teamList) {
      const resultChannelCreate = await app.client.conversations.create({
        token: context.botToken,
        name: team,
      });
      if (!resultChannelCreate.channel) {
        // TODO: チャンネル作成できなかった場合のエラーハンドリング
        throw new Error();
      }
      const createdChannel = resultChannelCreate.channel ? resultChannelCreate.channel.id : "";

      // 2. 作成したチームチャンネルに招待（教師と学生）
      const students: string[] = [];
      slackUsers.members?.filter((member) => {
        const email = member.profile?.email;
        if (
          !!email &&
          sheetStudents.some(
            ([sheetEmail, sheetName, sheetUserName, sheetTeam]) => sheetEmail === email && sheetTeam === team
          )
        ) {
          students.push(member.id!);
        }
      });
      const addMembers = selectedTeacher?.concat(students!);

      // Call conversations.invite
      await app.client.conversations.invite({
        token: context.botToken,
        channel: createdChannel!,
        users: [...addMembers!].join(","),
      });
    }
  } catch (err) {
    console.log(`error: ${toPrettfiedJSONString(err)}`);
  }
};

//#region Block Build
// チームチャンネル作成失敗お知らせモーダル
function buildFailedCreateTeamChannelModalView(teamList: string[]): View {
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "チームチャンネル作成失敗",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: "以下のチームチャンネルが既に存在するためチャンネルの作成が行えませんでした。",
      },
    },
  ];

  for (const team of teamList) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `・ ${team}`,
      },
    });
  }

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "チームチャンネルを新たに作成したい場合は全てのチームチャンネルを削除してください。",
    },
  });

  const modalView: View = {
    type: "modal",
    callback_id: "failedTeam",
    title: {
      type: "plain_text",
      text: "チームチャンネル作成",
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
}

/* eslint-disable no-console */
/* eslint-disable import/no-internal-modules */
import "../utils/env";
import { Middleware, KnownBlock, SlackEventMiddlewareArgs, Button } from "@slack/bolt";
import { readAsignments, readLessons, readStudents } from "../libs/spreadsheet";

export const TEACHER_CHANNEL_NAME = "教師用";

type Lesson = {
  name: string;
  channelId: string;
  teacherId: string;
  spreadsheetId: string;
  asignments?: Asignment[];
};

type Asignment = {
  name: string;
  channelId: string;
  url: string;
};

type Link = {
  channleName: string;
  channelId: string;
  taskName?: string;
  taskUrl?: string;
};

type UserType = "admin" | "teacher" | "student"; // admin or none -> teacher or student

//#region Block Build

function buildHeader() {
  return {
    type: "header",
    text: {
      type: "plain_text",
      text: " 遠隔教育プラットフォーム ",
    },
  };
}
function buildDivider() {
  return {
    type: "divider",
  };
}
function buildBlank() {
  return {
    type: "context",
    elements: [
      {
        type: "image",
        image_url: "https://api.slack.com/img/blocks/bkb_template_images/placeholder.png",
        alt_text: "  ",
      },
    ],
  };
}
function buildTitle(title: string) {
  return [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${title}*`,
      },
    },
    {
      type: "divider",
    },
  ];
}
function buildButtonSection(text: string, buttonText: string, url = "", value = ""): KnownBlock {
  const accessory: Button = {
    type: "button",
    text: {
      type: "plain_text",
      text: buttonText,
      emoji: true,
    },
  };
  if (!!url) {
    accessory.url = url;
  }
  if (!!value) {
    accessory.value = value;
  }

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text,
    },
    accessory,
  };
}

function buildGithubClassroomLink() {
  return buildButtonSection(":link: *GitHub Classroom* ", "Go to classroom", "https://classroom.github.com/classrooms");
}

function buildChannelLink(channelLinks: Link[]) {
  const links: KnownBlock[] = [];
  if (channelLinks.length === 0) {
    return [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "チャンネルが見つかりませんでした。",
        },
      },
    ];
  }
  channelLinks.forEach((link) => {
    const text = link.taskName
      ? `*${link.channleName}*\n\n    :clipboard:<${link.taskUrl}|${link.taskName}>`
      : `*${link.channleName}*`;
    links.push(
      buildButtonSection(text, "Go to channel", `https://${process.env.SLACK_DOMAIN}/archives/${link.channelId}`)
    );
  });
  return links;
}
//#endregion

/**
 * 全授業取得
 *
 * @returns 全ての授業情報
 */
const fetchLessons = async (): Promise<Lesson[]> => {
  // 授業情報全取得
  const lessons = await readLessons(process.env.LESSON_SHEET_ID!);
  return lessons.reduce((acc: Lesson[], lesson) => {
    if (!lesson[1]) {
      // channelIdが未記載の場合は抜かす。
      return acc;
    }
    const sheetData: Lesson = {
      name: lesson[0],
      channelId: lesson[1],
      teacherId: lesson[2],
      spreadsheetId: lesson[3],
    };
    return [...acc, sheetData];
  }, []);
};

/**
 * 授業ごとの課題取得
 *
 * @param 授業シート: スプレッドシートID
 * @returns 授業内のすべての課題情報
 */
const fetchAsignments = async (spreadsheetId: string): Promise<Asignment[]> => {
  if (!spreadsheetId) {
    return [];
  }
  const asignments = await readAsignments(spreadsheetId);
  if (asignments.length === 0) {
    return [];
  }
  return asignments.map((asignment) => {
    const sheetData: Asignment = {
      name: asignment[0],
      channelId: asignment[1],
      url: asignment[2],
    };
    return sheetData;
  });
};

/**
 * 授業ごとの受講学生取得
 *
 * @returns 授業と対応学生リスト
 */
const fetchStudents = async (): Promise<Map<string, string[]>> => {
  const lessons = await fetchLessons();
  const studentMap = new Map();
  for (const lesson of lessons) {
    const students = await readStudents(lesson.spreadsheetId);
    studentMap.set(lesson.channelId, students);
  }
  return studentMap;
};

/**
 * 学生の受講授業検索
 */
const searchStudentLessons = (lessons: Lesson[], studentMap: Map<string, string[]>, email: string): Lesson[] => {
  if (email === "") {
    return [];
  }

  const studentLessons: Lesson[] = [];
  studentMap.forEach((students, lessonChannel) => {
    for (const student of students) {
      if (student !== email) {
        continue;
      }
      const lesson = lessons.find((v) => v.channelId === lessonChannel);
      !!lesson && studentLessons.push(lesson);
      break;
    }
  });
  return studentLessons;
};

/**
 * 授業リンク作成
 */
const createLessonLinks = (lessons: Lesson[], user: UserType): Link[] => {
  const lessonLinks: Link[] = [];
  let taskName = "";

  if (user === "teacher") {
    taskName = "成績シート閲覧";
  }

  lessons.forEach((lesson) => {
    lessonLinks.push({
      channleName: lesson.name,
      channelId: lesson.channelId,
      taskName,
      taskUrl: !!taskName ? `https://docs.google.com/spreadsheets/d/${lesson.spreadsheetId}` : "",
    });
  });
  return lessonLinks;
};

/**
 * 課題リンク作成
 */
const createAsignmentLinks = async (lessons: Lesson[], user: UserType): Promise<Link[]> => {
  const asignments: Asignment[] = [];
  let taskName = "";

  if (user === "student") {
    taskName = "課題回答ページ";
  }
  for (const lesson of lessons) {
    if (!lesson.spreadsheetId) {
      continue;
    }
    const fetchData = await fetchAsignments(lesson.spreadsheetId);
    fetchData.length !== 0 && asignments.push(...fetchData);
  }

  const asignmentLinks: Link[] = [];
  for (const asignment of asignments) {
    asignmentLinks.push({
      channleName: asignment.name,
      channelId: asignment.channelId,
      taskName: taskName && asignment.url ? taskName : "",
      taskUrl: taskName && asignment.url ? asignment.url : "",
    });
  }
  return asignmentLinks;
};

// "app_home_opened"の実行時に呼び出されるリスナー関数
export const appHomeOpenedRequest: Middleware<SlackEventMiddlewareArgs<"app_home_opened">> = async ({
  event,
  client,
  logger,
  context,
}) => {
  try {
    // userから属性を照会 （管理者or一般ユーザー -> 教師orそれ以外(現在教師チャンネルから照会))
    const userTypes: UserType[] = [];

    const conversasionsListResponse = await client.conversations.list({
      token: context.botToken,
      types: "public_channel,private_channel",
    });
    const channels = conversasionsListResponse.channels ?? [];

    const user = await client.users.info({
      token: context.botToken,
      user: event.user,
    });
    if (user.user?.is_admin) {
      userTypes.push("admin");
    }
    const teacherChannel = channels.find((v) => v.name === TEACHER_CHANNEL_NAME);

    const members = await client.conversations.members({
      token: context.botToken,
      channel: teacherChannel?.id ?? "",
    });
    if (user.user?.id && members.members?.includes(user.user?.id)) {
      userTypes.push("teacher");
    } else {
      userTypes.push("student");
    }

    // 授業担当チャンネルを検索（teacher と studentで)
    const lessons = await fetchLessons();
    let lessonLinks: Link[] = [];
    let asignmentLinks: Link[] = [];

    if (userTypes.includes("teacher")) {
      // 教師が担当の授業をlesson sheetから検索
      const teacherLessons = lessons.filter((v) => !!v.teacherId);
      lessonLinks = createLessonLinks(teacherLessons, "teacher");
      asignmentLinks = await createAsignmentLinks(teacherLessons, "teacher");
    } else if (userTypes.includes("student")) {
      // 学生の受講授業一覧取得
      const email = user.user?.profile?.email;
      const studentMap = await fetchStudents();
      const studentLessons: Lesson[] = searchStudentLessons(lessons, studentMap, email ? email : "");

      lessonLinks = createLessonLinks(studentLessons, "student");
      asignmentLinks = await createAsignmentLinks(studentLessons, "student");
    }

    const blocks = [buildHeader(), buildDivider()]; // Title
    const contents = [
      buildBlank(),
      ...buildTitle("授業チャンネル"),
      ...buildChannelLink(lessonLinks),
      buildDivider(),
      buildBlank(),
      ...buildTitle("課題チャンネル"),
      ...buildChannelLink(asignmentLinks),
      buildDivider(),
    ];
    if (userTypes.includes("teacher")) {
      blocks.push(buildGithubClassroomLink());
    }
    blocks.push(...contents);

    const result = await client.views.publish({
      // イベントに紐づけられたユーザー ID を指定
      user_id: event.user,
      view: {
        type: "home",
        blocks,
      },
    });

    logger.info(result);
  } catch (error) {
    logger.error(error);
  }
};

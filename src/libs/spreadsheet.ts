// https://developers.google.com/sheets/api/quickstart/nodejs
// https://www.1ft-seabass.jp/memo/2020/05/08/npm-googleapis-google-sheet-await-async/
import { google } from "googleapis";
import type { UtResult } from "./github";

// If modifying these scopes, delete token.json.
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.appdata",
  "https://www.googleapis.com/auth/drive.scripts",
  "https://www.googleapis.com/auth/drive.metadata",
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = "token.json";
const creds = JSON.parse(Buffer.from(process.env.ASPIRE_GOOGLE_CREDENTIAL_KEY!, "base64").toString("ascii"));
const jwtClient = new google.auth.JWT(creds.client_email, undefined, creds.private_key, SCOPES);
const sheets = google.sheets({ version: "v4" });

async function validJWT(): Promise<void> {
  try {
    await jwtClient.authorize();
  } catch (error: any) {
    console.log("Auth Error: " + error);
    throw error;
  }
}

const LAST_ROW = "AA"; // 取得最大行（変更可能）

// spreadsheet情報
const MASTER_SHEETNAME_LESSON = "lesson"; // 授業マスタ：授業一覧用シート名
const MASTER_LESSON_INSERT_START_ROW = "B"; // 授業マスタ 授業一覧シート: 授業情報書き込み開始列
const MASTER_LESSON_LESSON_NAME_ROW = "A"; // 授業マスタ 授業一覧シート: 授業名の列
const MASTER_LESSON_CHANNEL_ID_ROW = "B"; // 授業マスタ 授業一覧シート: slackチャンネルIDの列

const LESSONSHEET_SHEETNAME_STUDENT = "学生"; // 授業シート：学生一覧用シート名
const LESSONSHEET_SHEETNAME_ASIGNMENT = "課題一覧"; // 授業シート：課題一覧用シート名
const LESSONSHEET_SHEETNAME_SCORE = "成績"; // 授業シート：成績用シート名

/**
 * シート検索
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName - シート名
 * @returns
 */
export async function findSheet(spreadsheetId: string, sheetName: string): Promise<{ [key: string]: any }[]> {
  try {
    await validJWT();
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: sheetName,
    });
    const header = responseGetSheet.data.values?.shift() || [];

    const datas =
      responseGetSheet.data.values?.map((v) => {
        const row: { [key: string]: any } = {};
        header.forEach((key, index) => {
          row[key] = v[index];
        });
        return row;
      }) ?? [];
    return datas;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * シート内データ取得（先頭から, ～LAST_ROW列まで）
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName - シート名
 * @returns シート内データ [[A1,B1,C1,...], [A2,B2,C2,...], ...]
 */
export async function readSheet(spreadsheetId: string, sheetTitle: string): Promise<string[][]> {
  try {
    await validJWT();
    const cells = `${sheetTitle}!A:${LAST_ROW}`;
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: cells,
    });
    console.log(responseGetSheet.data.values);
    return responseGetSheet.data.values ?? [];
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * シート内書き込み（先頭から）
 *
 * @param spreadsheetId - 対象スプレッドシートID
 * @param sheetTitle - 対象シート名
 * @param values - 書き込みデータ [[A1,B1,C1,...], [A2,B2,C2,...], ...]
 */
export async function writeSheet(spreadsheetId: string, sheetTitle: string, values: string[][]): Promise<void> {
  try {
    await validJWT();
    const insertRequest = {
      auth: jwtClient,
      spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values,
      },
    };
    await sheets.spreadsheets.values.append(insertRequest);
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 列検索：列内から検索キーワードと一致する行番号取得
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetName - シート名
 * @param searchColumn - 検索列
 * @param searchWord - 検索語
 * @returns - 行番号
 */
export async function findRowNum(
  spreadsheetId: string,
  sheetName: string,
  searchColumn: string,
  searchWord: string
): Promise<number> {
  try {
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: `${sheetName}!${searchColumn}:${searchColumn}`, // 例) range: "A:A"でA列を全検索
      majorDimension: "COLUMNS",
    });
    if (responseGetSheet.data.values === null || responseGetSheet.data.values?.length === 0) {
      return 0;
    }
    const result = responseGetSheet.data.values!;
    const rowNum = result[0].indexOf(searchWord) + 1;
    return rowNum;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * スプレッドシート内のすべてのシート名取得
 *
 * @param spreadsheetId - スプレッドシートID
 * @returns シート名リスト
 */
export async function getAllSheets(spreadsheetId: string): Promise<string[]> {
  const sheetsGet = await sheets.spreadsheets.get({
    auth: jwtClient,
    spreadsheetId,
  });
  const sheetList = sheetsGet.data.sheets ? sheetsGet.data.sheets : [];
  return sheetList.map((v) => v.properties?.title!);
}

/**
 * シートID検索（シート名から検索）
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetTitle - シート名
 * @return 検索シートのシートID
 */
export async function findSheetIdByTitle(spreadsheetId: string, sheetTitle: string): Promise<number> {
  const sheetsGet = await sheets.spreadsheets.get({
    auth: jwtClient,
    spreadsheetId,
  });
  const sheetList = sheetsGet.data.sheets ? sheetsGet.data.sheets : [];
  const sheet = sheetList.find((v) => v.properties?.title === sheetTitle)?.properties?.sheetId;
  if (!sheet) {
    return -1;
  }
  return sheet;
}

/**
 * シートID検索（シートindexから検索）
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetTitle - シートのindex
 * @return 該当indexのシートID
 */
export async function findSheetIdByIndex(spreadsheetId: string, sheetIndex: number): Promise<number> {
  const sheetsGet = await sheets.spreadsheets.get({
    auth: jwtClient,
    spreadsheetId,
  });
  const sheetList = sheetsGet.data.sheets ? sheetsGet.data.sheets : [];
  const sheet = sheetList.find((v) => v.properties?.index === sheetIndex)?.properties?.sheetId;
  if (!sheet) {
    return -1;
  }
  return sheet;
}

/**
 * スプレッドシート作成
 *
 * @param title - 作成したいスプレッドシート名
 * @returns 作成されたspreadsheetID
 */
export async function createSpreadsheet(title: string): Promise<string> {
  try {
    const spreadsheet = await sheets.spreadsheets.create({
      auth: jwtClient,
      requestBody: {
        properties: {
          title,
        },
      },
    });
    return spreadsheet.data.spreadsheetId ?? ""; // 作成されなかった場合は""を返す。呼び出し元でハンドリングする。
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * シート作成
 *
 * @param spreadsheetId - スプレッドシートID
 * @param title - 作成したいシート名
 */
export async function createSheet(spreadsheetId: string, title: string): Promise<void> {
  try {
    await sheets.spreadsheets.batchUpdate({
      auth: jwtClient,
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title,
              },
            },
          },
        ],
      },
    });
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * シート名変更
 *
 * @param spreadsheetId - スプレッドシートID
 * @param sheetId - 対象シートID
 * @param title - シート名
 */
export async function renameSheet(spreadsheetId: string, sheetId: number, title: string): Promise<void> {
  try {
    await sheets.spreadsheets.batchUpdate({
      auth: jwtClient,
      spreadsheetId,
      requestBody: {
        requests: [
          {
            updateSheetProperties: {
              properties: {
                sheetId,
                title,
              },
              fields: "title",
            },
          },
        ],
      },
    });
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * シートのコピー
 *
 * @param spreadsheetId - コピー元 スプレッドシートID
 * @param sheetId - コピー元 シートID
 * @param destinationSpreadsheetId - コピー先 スプレッドシートID
 * @returns コピー後シートID
 */
export async function copySheet(
  spreadsheetId: string,
  sheetId: number,
  destinationSpreadsheetId: string
): Promise<number> {
  try {
    const copyToResponse = await sheets.spreadsheets.sheets.copyTo({
      auth: jwtClient,
      spreadsheetId,
      sheetId,
      requestBody: {
        destinationSpreadsheetId,
      },
    });
    return copyToResponse.data.sheetId ?? -1;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * Google driveフォルダにファイルを追加する
 *
 * @param fileId - 追加ファイルID
 * @param folderId - 追加先フォルダID
 */
export async function addFileParent(fileId: string, folderId: string): Promise<void> {
  try {
    const drive = google.drive({ version: "v3" });

    await drive.files.update({
      auth: jwtClient,
      fileId: fileId,
      addParents: folderId,
    });
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 権限作成
 *
 * @param fileId - ファイルID
 * @param emailAddress - 権限付与したいメールアドレス
 * @param role - 権限 writer編集者, owner管理者
 */
export async function permissionCreate(fileId: string, emailAddress: string, role: "writer" | "owner"): Promise<void> {
  try {
    const drive = google.drive({ version: "v3" });

    const permissionCreateResponse = await drive.permissions.create({
      auth: jwtClient,
      fileId,
      requestBody: {
        role: "writer",
        type: "user",
        emailAddress,
      },
    });

    // owner権限移行の場合は、permissions.createの後にupdateを実行
    if (role === "owner") {
      const permissionId = permissionCreateResponse.data.id ?? "";
      await drive.permissions.update({
        auth: jwtClient,
        fileId,
        permissionId,
        transferOwnership: true,
        requestBody: {
          role: "owner",
        },
      });
    }
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * Githubからの結果を各授業シートに書き込み
 *
 * @param spreadsheetId
 * @param sheetTitle
 * @param result
 * @param sha
 * @returns
 */
export async function writeGithubResult(
  spreadsheetId: string,
  sheetTitle: string,
  result: UtResult,
  sha: string
): Promise<void> {
  try {
    if (!result) {
      return;
    }
    await validJWT();
    const insertRequest = {
      auth: jwtClient,
      spreadsheetId,
      range: `${sheetTitle}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      resource: {
        values: [
          [
            result.repo,
            result.username,
            result.tests,
            result.failures,
            result.ignored,
            result.successRate,
            result.date,
            sha,
          ],
        ],
      },
    };
    await sheets.spreadsheets.values.append(insertRequest);
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業マスタ：授業マスタ内 授業一覧を読み込み
 *
 * @param spreadsheetId - 授業マスタ スプレッドシートID
 * @returns 授業マスタ情報
 */
export async function readLessons(spreadsheetId: string): Promise<string[][]> {
  try {
    await validJWT();
    const cells = `${MASTER_SHEETNAME_LESSON}!A2:${LAST_ROW}`; // 1行目はタイトルなので取得しない
    console.log("call sheets.spreadsheets.values.get");
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: cells,
    });
    const values = responseGetSheet.data.values;
    return !!values ? values : [[]];
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業マスタ：授業マスタ内の学生メールアドレス一覧取得
 *
 * @param spreadsheetId  - 授業マスタ スプレッドシートID
 * @param lessonName - 授業マスタ内 学生情報取得したい授業名（シート名と対応させる）
 * @returns 対象授業を受講する学生のメールアドレス一覧
 */
export async function readStudentsFromLessonMst(spreadsheetId: string, lessonName: string): Promise<string[]> {
  try {
    await validJWT();
    const cells = `${lessonName}!A2:B`; // A列にメールアドレス
    sheets.spreadsheets;
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: cells,
      majorDimension: "COLUMNS",
    });

    // [[mail1,mail2,mail3,...], [name1,name2,name3]]
    const students = responseGetSheet.data.values ? responseGetSheet.data.values[0] : [];
    return students;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業マスタ：登録した授業情報書き込み
 *
 * @param spreadsheetId - 授業マスタスプレッドシートID
 * @param lessonName - 書き込み内容：授業名
 * @param lessonChannel - 書き込み内容：授業チャンネル名
 * @param teacherID  - 書き込み内容：授業担当slackID
 * @param lessonSpreadsheetId  - 書き込み内容：授業に対応する授業シートのスプレッドシートID
 * @returns 書き込み結果
 */
export async function writeLessonChannel(
  spreadsheetId: string,
  lessonName: string,
  lessonChannel: string,
  teacherID: string,
  lessonSpreadsheetId: string
): Promise<boolean> {
  try {
    await validJWT();

    const insertRowNum = await findRowNum(spreadsheetId, MASTER_SHEETNAME_LESSON, "A", lessonName);
    if (insertRowNum === 0) {
      // TODO 授業が見つからなかった場合
      throw new Error();
    }
    await sheets.spreadsheets.values.update({
      auth: jwtClient,
      spreadsheetId,
      range: `${MASTER_SHEETNAME_LESSON}!${MASTER_LESSON_INSERT_START_ROW}${insertRowNum}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        majorDimension: "ROWS",
        range: `${MASTER_SHEETNAME_LESSON}!${MASTER_LESSON_INSERT_START_ROW}${insertRowNum}`,
        values: [[lessonChannel, teacherID, lessonSpreadsheetId]],
      },
    });

    return true;
  } catch (error) {
    console.log("The API returned an error: " + error);
    return false;
  }
}

/**
 * 授業マスタ: 授業チャンネルslackIDから該当授業の授業シートを取得
 *
 * @param spreadsheetId - 授業マスタスプレッドシートID
 * @param channelId - 検索したい授業のチャンネルID
 * @returns 授業シート スプレッドシートID
 */
export async function findSpreadsheetByChannelId(spreadsheetId: string, channelId: string): Promise<string> {
  try {
    await validJWT();
    const rowNum = await findRowNum(spreadsheetId, MASTER_SHEETNAME_LESSON, MASTER_LESSON_CHANNEL_ID_ROW, channelId);
    if (rowNum === 0) {
      // 授業が見つからなかった場合
      return "";
    }
    const dataGetResponse = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: `${MASTER_SHEETNAME_LESSON}!D${rowNum}`,
    });
    if (!dataGetResponse || !dataGetResponse.data.values) {
      return "";
    }
    const asignmentSpreadsheetId: string = dataGetResponse.data.values[0][0];
    return asignmentSpreadsheetId;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業マスタ: 授業名から授業シートのスプレッドシートIDを検索
 *
 * @param spreadsheetId - 授業マスタ スプレッドシートID
 * @param lessonName - 授業名
 * @returns 授業シートスプレッドシートID
 */
export async function findChannelSpreadsheetId(spreadsheetId: string, lessonName: string): Promise<string> {
  try {
    await validJWT();

    const rowNum = await findRowNum(spreadsheetId, MASTER_SHEETNAME_LESSON, MASTER_LESSON_LESSON_NAME_ROW, lessonName);
    if (rowNum === 0) {
      // 授業が見つからなかった場合
      return "";
    }

    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: `D${rowNum}`,
      majorDimension: "COLUMNS",
    });

    const sheetId = responseGetSheet.data.values ? responseGetSheet.data.values[0][0] : "";
    return sheetId;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業マスタ: slackチャンネルIDから教師ID取得
 *
 * @param spreadsheetId - 授業マスタ スプレッドシートID
 * @param channelId - 授業slackチャンネルID
 * @returns 授業担当教師slackID
 */
export async function findChannelBySlackId(spreadsheetId: string, channelId: string): Promise<string | undefined> {
  try {
    await validJWT();

    const rowNum = await findRowNum(spreadsheetId, MASTER_SHEETNAME_LESSON, MASTER_LESSON_CHANNEL_ID_ROW, channelId);
    if (rowNum === 0) {
      // 授業が見つからなかった場合
      return;
    }

    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: `C${rowNum}`,
      majorDimension: "COLUMNS",
    });

    return responseGetSheet.data.values && responseGetSheet.data.values[0][0];
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業シート: 授業シートから学生情報取得
 *
 * @param spreadsheetId  - 授業シート スプレッドシートID
 * @returns
 */
export async function readStudents(spreadsheetId: string): Promise<string[]> {
  try {
    await validJWT();
    const cells = `${LESSONSHEET_SHEETNAME_STUDENT}!A2:B`;
    sheets.spreadsheets;
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: cells,
      majorDimension: "COLUMNS",
    });
    const students = responseGetSheet.data.values ? responseGetSheet.data.values[0] : [];
    return students;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業シート: 授業シートから課題情報取得
 *
 * @param spreadsheetId  - 授業シート スプレッドシートID
 * @returns
 */
export async function readAsignments(spreadsheetId: string): Promise<string[][]> {
  try {
    await validJWT();
    const cells = `${LESSONSHEET_SHEETNAME_ASIGNMENT}!A2:C`;
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: cells,
    });
    const values = responseGetSheet.data.values;
    return !!values ? values : [];
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業シート：課題シート作成（Githubからの情報を記載用の課題シート）
 *
 * @param spreadsheetId - 授業シート スプレッドシートID
 * @param title - 課題シート名
 */
export async function createAsignmentSheet(spreadsheetId: string, title: string): Promise<void> {
  try {
    await createSheet(spreadsheetId, title);

    const insertRequest = {
      auth: jwtClient,
      spreadsheetId,
      range: `${title}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "OVERWRITE",
      resource: {
        values: [["repo", "username", "tests", "failures", "ignored", "successRate", "date", "sha"]],
      },
    };
    await sheets.spreadsheets.values.append(insertRequest);
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業シート：成績シートに課題名を書き込み
 *
 * @param spreadsheetId - 授業シート スプレッドシートID
 * @param title - 課題シート名
 */
export async function writeAsignmentToResultSheet(spreadsheetId: string, title: string): Promise<void> {
  try {
    await validJWT();
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: `${LESSONSHEET_SHEETNAME_SCORE}!C1:X1`,
    });

    // 成績シートに課題名を書き込む列番号
    let writeColumnNum = 0;
    if (!responseGetSheet.data.values || responseGetSheet.data.values.length === 0) {
      // C列に書き込み
      writeColumnNum = 3;
    } else {
      // A~B列(2) + ["kadai1", "", "kadai2"] + 空白列(1) の右隣(1)
      writeColumnNum = 2 + responseGetSheet.data.values![0].length + 2;
    }

    const writeCell = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: `${LESSONSHEET_SHEETNAME_SCORE}!R1C${writeColumnNum}`,
    });
    const updateResult = await sheets.spreadsheets.values.update({
      auth: jwtClient,
      spreadsheetId,
      range: writeCell.data.range!,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [[title]],
      },
    });
    console.log("update", updateResult.data.updatedCells);
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業シート：作成した課題情報書き込み
 *
 * @param lessonSpreadsheetId - 授業マスタ スプレッドシートID
 * @param lessonChannelId - 授業 slackチャンネルID
 * @param channelName - 課題 slackチャンネル名
 * @param channelId - 課題 slackチャンネルID
 * @param url - 課題url
 */
export async function writeAsignmentData(
  lessonSpreadsheetId: string,
  lessonChannelId: string,
  channelName: string,
  channelId: string,
  url: string
): Promise<void> {
  try {
    await validJWT();

    const asignmentSpreadsheetId = await findSpreadsheetByChannelId(lessonSpreadsheetId, lessonChannelId);
    if (!asignmentSpreadsheetId) {
      return;
    }

    await sheets.spreadsheets.values.append({
      auth: jwtClient,
      spreadsheetId: asignmentSpreadsheetId,
      range: `${LESSONSHEET_SHEETNAME_ASIGNMENT}!A1`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [[channelName, channelId, url]],
      },
    });
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業マスタ: 授業マスタ内の学生チーム一覧取得
 *
 * @param spreadsheetId  - 授業マスタ スプレッドシートID
 * @returns 学生の所属チーム一覧
 */
export async function findTeamList(spreadsheetId: string): Promise<string[]> {
  try {
    await validJWT();
    const cells = `${LESSONSHEET_SHEETNAME_STUDENT}!A2:D`;
    sheets.spreadsheets;
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: cells,
      majorDimension: "COLUMNS",
    });
    const students = responseGetSheet.data.values ? responseGetSheet.data.values[3] : [];
    return students;
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

/**
 * 授業マスタ：授業マスタ内 学生情報一覧を読み込み
 *
 * @param spreadsheetId - 授業マスタ スプレッドシートID
 * @returns 授業マスタ情報
 */
export async function readStudensInfo(spreadsheetId: string): Promise<string[][]> {
  try {
    await validJWT();
    const cells = `${LESSONSHEET_SHEETNAME_STUDENT}!A2:${LAST_ROW}`; // 1行目はタイトルなので取得しない
    console.log("call sheets.spreadsheets.values.get");
    const responseGetSheet = await sheets.spreadsheets.values.get({
      auth: jwtClient,
      spreadsheetId,
      range: cells,
    });
    const values = responseGetSheet.data.values;
    return !!values ? values : [[]];
  } catch (error) {
    console.log("The API returned an error: " + error);
    throw error;
  }
}

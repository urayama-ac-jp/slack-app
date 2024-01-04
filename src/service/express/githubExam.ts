import { Request, Response } from "express";
import {
  createAsignmentSheet,
  createSheet,
  getAllSheets,
  writeAsignmentToResultSheet,
  writeGithubResult,
} from "../../libs/spreadsheet";
import { fetchArtifact } from "../../libs/github";

const _sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * github連携
 *
 * @param req express Request
 * @param res express Response
 */
export default async function (req: Request, res: Response) {
  try {
    const { repo, sha, username, sheetid: spreadsheetId } = req.body;
    // responseを先に返す
    res.status(200);
    res.send("");
    const reponame: string = repo;
    if (!reponame.endsWith(username)) {
      throw new Error();
    }
    const sheets = await getAllSheets(spreadsheetId);
    // repo名から課題名切り出し(repo名はkadainame-username。repo名からusername分文字数削除)
    const title = reponame.slice(0, -(username.length + 1));
    const sheet = sheets?.find((v) => {
      return v === title;
    });
    if (!sheet) {
      await createAsignmentSheet(spreadsheetId, title); // 課題シート作成
      await writeAsignmentToResultSheet(spreadsheetId, title); // 成績シートに課題名追加
    }
    await _sleep(16000);
    const utResult = await fetchArtifact(repo, username);
    console.log("github result: ", utResult);
    if (!utResult) {
      return;
    }
    await writeGithubResult(spreadsheetId, title, utResult, sha);
  } catch (error: any) {
    console.log("github ng");
    console.log(error);
  }
}

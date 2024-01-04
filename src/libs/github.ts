/**
 * https://octokit.github.io/rest.js/v18
 *
 * workflows.yamlに以下を追加
 * permissions:
 *   contents: read
 *
 * userのtokenを取得
 */
import { Octokit } from "@octokit/rest";
import JSZip from "jszip";
import { load } from "cheerio";

export type UtResult = {
  repo: string;
  username: string;
  date: Date;
  tests: number;
  failures: number;
  ignored: number;
  successRate: string;
};

const octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN,
});

export const fetchArtifact = async (repo: string, username: string): Promise<UtResult | null> => {
  try {
    // get latest artifact
    const artifactlist = await octokit.rest.actions.listArtifactsForRepo({
      owner: process.env.GITHUB_OWNER!,
      repo,
      per_page: 100,
    });
    const artifactInfo = artifactlist.data.artifacts.sort((a, b) => b.id - a.id).find((v) => !!v);
    if (!artifactInfo) {
      return null;
    }

    // parse artifact
    const downloadArtifact = await octokit.rest.actions.downloadArtifact({
      owner: process.env.GITHUB_OWNER!,
      repo,
      artifact_id: artifactInfo.id,
      archive_format: "zip",
    });
    if (!downloadArtifact || !downloadArtifact.data || !(downloadArtifact.data instanceof ArrayBuffer)) {
      return null;
    }
    const data = await JSZip.loadAsync(downloadArtifact.data);
    const html = await data.files["index.html"].async("text");
    const $ = load(html);
    const result: UtResult = {
      repo,
      username,
      date: new Date(Date.now() + (new Date().getTimezoneOffset() + 9 * 60) * 60 * 1000),
      tests: Number($("#tests div:first").text()),
      failures: Number($("#failures div:first").text()),
      ignored: Number($("#ignored div:first").text()),
      successRate: $("#successRate div:first").text(),
    };
    return result;
  } catch (err: any) {
    console.error(err);
    throw err;
  }
};

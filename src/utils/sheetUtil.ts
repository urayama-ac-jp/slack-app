// spreadsheet関連util

/**
 * spreedsheetから取得した授業一覧から、チャンネル未作成の授業のみリスト化
 *
 * 前提として授業名は一意である必要あり
 */
export const makeUnregisteredLessonList = (
  sheetLessons: string[][] | null | undefined
): { id: string; name: string }[] => {
  // [[lessonName, channelID], ....]
  if (!sheetLessons) return [];

  return sheetLessons
    .filter((lesson) => !lesson[1])
    .map((lesson) => {
      return { id: lesson[0], name: lesson[0] };
    });
};

/**
 * spreedsheetから取得した学生の所属チーム名から、チームリスト化
 */
export const makeTeamList = (sheetTeams: string[]) => {
  const teamList: string[] = [];
  for (const team of sheetTeams) {
    if (!teamList.includes(team)) {
      teamList.push(team);
    }
  }
  return teamList;
};

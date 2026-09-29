/**
 * 탁구 게임 녹화 영상을 구글 드라이브 폴더에 저장하는 Apps Script 웹앱.
 *
 * 설정:
 *  1) 아래 FOLDER_ID 를 저장할 드라이브 폴더 ID로 바꾸세요.
 *     (폴더를 열면 주소창이 .../folders/<이 부분이 ID> 입니다.)
 *  2) 배포 > 새 배포 > 웹 앱
 *       - 실행: 나(본인)
 *       - 액세스 권한: 모든 사용자
 *     배포하면 나오는 웹앱 URL(.../exec)을 pingpong.js 의 APPS_SCRIPT_URL 에 붙여넣으세요.
 */

const FOLDER_ID = "1Sp9sujSuk-OvTVYA7TSYMbJ-zhB6Gg1o";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const bytes = Utilities.base64Decode(body.data);
    const blob = Utilities.newBlob(bytes, body.mimeType || "video/webm", body.filename);
    const folder = DriveApp.getFolderById(FOLDER_ID);
    const file = folder.createFile(blob);
    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, id: file.getId(), name: file.getName() })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

// 브라우저에서 URL을 그냥 열었을 때 살아있는지 확인용
function doGet() {
  return ContentService.createTextOutput("Study/PingPong uploader is running.");
}

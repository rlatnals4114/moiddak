// 네트워크·세션 오류를 사용자가 이해할 수 있는 문장으로 바꾼다. DB 함수가 던진 한국어 안내는 그대로 둔다.
export function friendly(message = '') {
  if (/failed to fetch|networkerror|load failed|network request failed|fetch/i.test(message)) {
    return '인터넷 연결이 불안정해서 처리하지 못했어요. 연결을 확인하고 다시 눌러 주세요.';
  }
  if (/jwt|token is expired|invalid claim|refresh token/i.test(message)) {
    return '접속이 만료됐어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.';
  }
  if (/permission denied|row-level security/i.test(message)) {
    return '이 작업을 할 권한이 없어요. 내 개인 초대 링크로 들어왔는지 확인해 주세요.';
  }
  return message || '알 수 없는 오류가 났어요. 잠시 후 다시 시도해 주세요.';
}

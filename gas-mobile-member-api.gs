/*
 * Mobile member rack access patch.
 *
 * IMPORTANT:
 * - Existing tablet checkInNow flow is NOT changed.
 * - Tablet "すぐに利用" remains authentication-code free.
 * - Only mobileCheckInNow requires the 4-digit auth code.
 * - getMobileRackStatus checks ACT membership before returning rack status and never returns authCode.
 *
 * Integration in existing doPost(e):
 *   after `const action = String(body.action || '');` add:
 *
 *   if (action === 'getMobileRackStatus') {
 *     return ContentService
 *       .createTextOutput(JSON.stringify(getMobileRackStatus_(body.email)))
 *       .setMimeType(ContentService.MimeType.JSON);
 *   }
 *
 *   if (action === 'mobileCheckInNow') {
 *     return ContentService
 *       .createTextOutput(JSON.stringify(mobileCheckInNow_(body)))
 *       .setMimeType(ContentService.MimeType.JSON);
 *   }
 */

function getMobileRackStatus_(email) {
  try {
    const memberCheck = checkMemberByEmail_(email);

    if (!memberCheck || !memberCheck.ok) {
      return {
        ok: false,
        message: memberCheck && memberCheck.message
          ? memberCheck.message
          : '会員情報を確認できませんでした。'
      };
    }

    const data = getScheduleTabletJson_() || {};
    const member = memberCheck.member || {};

    return {
      ok: true,
      memberName: String(member.name || ''),
      todayLabel: String(data.todayLabel || ''),
      lastUpdatedText: String(data.lastUpdatedText || ''),
      racks: Array.isArray(data.racks) ? data.racks : []
    };

  } catch (e) {
    return {
      ok: false,
      message: 'ラック利用状況の取得に失敗しました。',
      error: String(e && e.message ? e.message : e)
    };
  }
}

function mobileCheckInNow_(body) {
  try {
    body = body || {};

    const inputCode = String(body.authCode || '').trim();
    const currentCode = String(getAuthCode_()).trim();

    if (!inputCode || inputCode !== currentCode) {
      return {
        ok: false,
        message: '認証コードが正しくありません。'
      };
    }

    const email = String(body.email || '').trim().toLowerCase();
    const memberCheck = checkMemberByEmail_(email);

    if (!memberCheck || !memberCheck.ok) {
      return {
        ok: false,
        message: memberCheck && memberCheck.message
          ? memberCheck.message
          : '会員情報を確認できませんでした。'
      };
    }

    return checkInNow({
      rackNo: String(body.rackNo || '').trim(),
      email: email,
      displayName: String(body.displayName || '').trim(),
      entryMethod: 'email',
      member: memberCheck.member
    });

  } catch (e) {
    return {
      ok: false,
      message: '利用登録処理でエラーが発生しました。',
      error: String(e && e.message ? e.message : e)
    };
  }
}

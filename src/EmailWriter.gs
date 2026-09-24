/**
 * EmailWriter.gs — renders the same report model as a client-ready Gmail draft.
 * The draft is never sent automatically: the consultant reviews it first.
 */
var LYN_LAST_EMAIL_KEY = 'LYN_LAST_CLIENT_EMAIL';

function lynCreateReportDraft_(report, recipient) {
  var subject = 'Your budget review — ' + report.period.month + ' ' + report.period.year;
  var draft = GmailApp.createDraft(recipient, subject, lynRenderPlainText_(report), {
    htmlBody: lynRenderEmailHtml_(report)
  });
  lynRememberEmail_(recipient);
  return draft;
}

/**
 * "Last client email" is a convenience only. Document properties may be
 * unavailable when this code runs as a library, so it must never break the draft.
 */
function lynLastEmail_() {
  try {
    return PropertiesService.getDocumentProperties().getProperty(LYN_LAST_EMAIL_KEY) || '';
  } catch (e) {
    return '';
  }
}

function lynRememberEmail_(email) {
  try {
    PropertiesService.getDocumentProperties().setProperty(LYN_LAST_EMAIL_KEY, email);
  } catch (e) {
    console.warn('Could not remember the client email: ' + e);
  }
}

/** Pure: report model -> HTML email body (inline styles only; Gmail strips <style>). */
function lynRenderEmailHtml_(report) {
  var esc = lynEscapeHtml_;
  var td = 'padding:6px 10px;border-bottom:1px solid #e5e5e5;';
  var num = td + 'text-align:right;white-space:nowrap;';

  var body = report.categories.map(function (c) {
    var html = '<tr style="' + (c.significant ? 'background:#fce4d6;font-weight:bold;' : '') + '">' +
      '<td style="' + td + '">' + esc(c.name) + '</td>' +
      '<td style="' + num + '">' + lynMoney_(c.planned) + '</td>' +
      '<td style="' + num + '">' + lynMoney_(c.actual) + '</td>' +
      '<td style="' + td + '">' + esc(c.status) + '</td></tr>';
    if (c.significant) {
      html += '<tr><td colspan="4" style="padding:6px 10px 12px 18px;">' +
        '<div style="font-style:italic;color:#843c0c;">' + esc(c.headline) + '</div>' +
        c.drivers.map(function (d) {
          return '<div style="background:#fff2cc;margin-top:4px;padding:2px 6px;">' + esc(lynDriverLine_(d)) + '</div>';
        }).join('') +
        '</td></tr>';
    }
    return html;
  }).join('');

  var flaggedIntro = report.flagged.length
    ? report.flagged.length + ' categor' + (report.flagged.length === 1 ? 'y needs' : 'ies need') + ' your attention this month (highlighted below).'
    : 'Every category stayed within ' + lynPercent_(report.threshold) + ' of plan this month. Great job!';

  var summary = report.summary.map(function (s) {
    return '<li>' + esc(s.name) + ': ' + lynMoney_(s.actual) + ' actual vs ' + lynMoney_(s.planned) + ' planned</li>';
  }).join('');

  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;">' +
    '<p>Hi,</p>' +
    '<p>Here is your budget review for <b>' + esc(report.period.month + ' ' + report.period.year) + '</b>. ' + flaggedIntro + '</p>' +
    '<table style="border-collapse:collapse;min-width:480px;">' +
    '<tr style="background:#1f3864;color:#fff;"><th style="' + td + 'text-align:left;">Category</th>' +
    '<th style="' + num + '">Planned</th><th style="' + num + '">Actual</th><th style="' + td + 'text-align:left;">Status</th></tr>' +
    body + '</table>' +
    (summary ? '<p><b>Bottom line</b></p><ul>' + summary + '</ul>' : '') +
    '<p>Let me know if you would like to go over any of these items together.</p>' +
    '<p>Best regards,</p></div>';
}

function lynEscapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

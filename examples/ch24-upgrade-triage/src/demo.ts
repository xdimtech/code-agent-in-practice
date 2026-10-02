import { between, parseChangelog } from "./changelog.ts";
import { BASE, CHANGELOG, LEDGER, NEXT, OURS, VENDOR_MARKER, VENDOR_SIBLINGS } from "./fixtures.ts";
import { parseLedger } from "./ledger.ts";
import { reconcile } from "./reconcile.ts";
import { printFates, printFiles, printFindings, printLedger, printReleases, printTally, section } from "./report.ts";
import { detectMoves, needsHuman, relocate, tally, triage } from "./triage.ts";
import { ageInDays, checkVendorMarker } from "./vendor.ts";

const TODAY = new Date("2026-09-05T00:00:00Z");

export function demo(): void {
  section("一、从 0.8.0 升到 0.9.1，CHANGELOG 里有什么");
  printReleases(between(parseChangelog(CHANGELOG).releases, "0.8.0", "0.9.1"));

  section("二、vendor 标记：基线钉在哪");
  const { marker, findings: markerFindings } = checkVendorMarker(VENDOR_MARKER, (p) => VENDOR_SIBLINGS.has(p));
  console.log(`  ${marker?.name} @ ${marker?.commit.slice(0, 8)}（${marker?.ref}），${marker?.importedAt} 导入，距今 ${ageInDays(marker?.importedAt ?? "", TODAY)} 天`);
  printFindings(markerFindings);

  section("三、补丁台账体检");
  const ledger = parseLedger(LEDGER);
  printLedger(ledger.entries);
  printFindings(ledger.findings);

  section("四、三方分诊：按路径直接比");
  const naive = triage(BASE, OURS, NEXT);
  printTally(tally(naive), naive.length);

  section("五、先把挪过的文件挪回去，再比");
  const moves = detectMoves(BASE, OURS);
  for (const m of moves) console.log(`  原样挪走：${m.from} → ${m.to}`);
  const files = triage(BASE, relocate(OURS, moves), NEXT);
  printTally(tally(files), files.length);
  printFiles(needsHuman(files));

  section("六、台账和实际改动对账");
  const { fates, findings } = reconcile(ledger.entries, files);
  printFates(fates);
  printFindings(findings);
}

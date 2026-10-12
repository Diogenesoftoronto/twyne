/** Executed original presentation helpers, with explicitly synthetic retained
 * DTOs. This never reads a provider, account, manuscript or hosted store. */
import { rubricGradeStampAsset, rubricGradeTier } from "../../../../src/utils/rubric-feedback";
import { clampWeight, stepWeight, weightedCriteriaScore } from "../../../../src/utils/rubric-criteria";
import { truncateGalleySummary } from "../../../../src/utils/galley-summary";

const record = await Bun.file(`${import.meta.dir}/../rubric/retained-native.json`).json();
const scope = "original/path/folio:café";
const artifact = record.folios[scope];
const result = artifact.result;
const visible = Object.fromEntries(result.criteria.map((c: any) => [c.id,c.score]));
const raw = Object.fromEntries(Object.values(result.judgementGrade.criteria).map((c: any) => [c.id,c.score]));
const stepped = artifact.criteria.map((c: any) => ({...c,weight:c.id === "thesis" ? stepWeight(clampWeight(2),1) : c.weight}));
const passages = [
  {id:"nothing-first",kind:"nothing",priority:100},
  {id:"first-same-quote",kind:"question",priority:.1},
  {id:"second-same-quote",kind:"evidence",priority:.9},
  {id:"third",kind:"advice",priority:.2},
  {id:"fourth",kind:"cut",priority:.3},
  {id:"fifth-not-shown",kind:"question",priority:99},
];
await Bun.write(`${import.meta.dir}/source-presentation.json`,JSON.stringify({
  provenance:"Executed original TypeScript presentation helpers. Retained DTOs are synthetic fixture data; no grading or provider call.",
  scope,
  initialWriterScore:weightedCriteriaScore(artifact.criteria,visible),
  typedTwoThenIncrease:stepWeight(clampWeight(2),1),
  editedWriterScore:weightedCriteriaScore(stepped,raw),
  fullReportAfterEdit:weightedCriteriaScore(stepped,visible),
  stamps:["A+","A","A-","B+","B","B-","C+","C","C-","D+","D","D-","F","?"].map(grade=>({grade,asset:rubricGradeStampAsset(grade),tier:rubricGradeTier(grade)})),
  summary:truncateGalleySummary(result.summary),
  passages,
  visiblePassageIds:passages.filter(p=>p.kind!=="nothing").slice(0,4).map(p=>p.id),
},null,2)+"\n");

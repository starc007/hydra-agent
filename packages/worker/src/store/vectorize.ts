export type ExperienceMetadata = {
  decision_id: string;
  do_id: string;
  action: string;
  score_4h: number;
  score_24h: number;
};

export type ExperienceMatch = ExperienceMetadata & { score: number };

export async function upsertExperience(
  index: VectorizeIndex,
  decisionId: string,
  vector: number[],
  metadata: ExperienceMetadata,
): Promise<void> {
  await index.upsert([{ id: decisionId, values: vector as unknown as VectorFloatArray, metadata }]);
}

export async function queryExperiences(
  index: VectorizeIndex,
  vector: number[],
  topK = 5,
): Promise<ExperienceMatch[]> {
  const result = await index.query(vector as unknown as VectorFloatArray, {
    topK,
    returnMetadata: 'all',
    filter: { score_24h: { $gt: 0 } },
  });
  return (result.matches ?? []).map((m) => ({
    ...(m.metadata as ExperienceMetadata),
    score: m.score,
  }));
}

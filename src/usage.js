// Only counters actually reported by the provider, never estimated plan usage or prices.
export function reportedUsage(data,provider) {
  if(!data || typeof data!=='object')return null;
  const keys=provider==='claude'?{input_tokens:'inputTokens',output_tokens:'outputTokens',cache_read_input_tokens:'cacheReadInputTokens',cache_creation_input_tokens:'cacheCreationInputTokens'}:{input_tokens:'inputTokens',output_tokens:'outputTokens',total_tokens:'totalTokens'};
  const result={};
  for(const [key,label] of Object.entries(keys))if(Number.isSafeInteger(data[key]) && data[key]>=0)result[label]=data[key];
  return Object.keys(result).length?result:null;
}

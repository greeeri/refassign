// A small evaluator for the paired PostgREST OR filters used by scope regression mocks.
function splitClauses(expression) {
  const result = []; let depth = 0, start = 0;
  for (let index = 0; index < expression.length; index++) {
    if (expression[index] === '(') depth++;
    else if (expression[index] === ')') depth--;
    else if (expression[index] === ',' && depth === 0) { result.push(expression.slice(start,index)); start=index+1; }
  }
  result.push(expression.slice(start));
  return result;
}
function matches(row, expression) {
  if (expression.startsWith('and(')) return splitClauses(expression.slice(4,-1)).every(item => matches(row,item));
  const equal = expression.match(/^([a-z_]+)\.eq\.(.*)$/);
  if (equal) return row?.[equal[1]] === equal[2];
  const within = expression.match(/^([a-z_]+)\.in\.\((.*)\)$/);
  if (within) return within[2].split(',').includes(row?.[within[1]]);
  throw new Error(`Unsupported test scope filter: ${expression}`);
}
exports.applyScopeFilter = (row, expression, options) => {
  const nested = options?.referencedTable ? options.referencedTable.split('.').reduce((value,key) => value?.[key],row) : row;
  return splitClauses(expression).some(item => matches(nested,item));
};

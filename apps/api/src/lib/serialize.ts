const internalFields = new Set(['passwordHash', 'tokenHash', 'csrfHash', 'storagePath', 'temporaryPath']);
export const serialize = (value: unknown): unknown => typeof value === 'bigint'
  ? value.toString()
  : value instanceof Date
    ? value.toISOString()
    : Array.isArray(value)
      ? value.map(serialize)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).filter(([key]) => !internalFields.has(key)).map(([key, item]) => [key, serialize(item)]))
        : value;

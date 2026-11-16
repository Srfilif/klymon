/** Resolves a Maven coordinate (group:artifact:version[:classifier][@ext]) to a repo path. */
export function mavenPathFromCoordinate(coordinate: string): string {
  const [coords, extension = 'jar'] = coordinate.split('@');
  const parts = (coords ?? '').split(':');
  const [group, artifact, version, classifier] = parts;
  if (!group || !artifact || !version) return coordinate.replace(/[:@]/g, '/');
  const fileName = `${artifact}-${version}${classifier ? `-${classifier}` : ''}.${extension}`;
  return [group.replace(/\./g, '/'), artifact, version, fileName].join('/');
}

export function splitForgeCoordinate(coordinate: string): { mcVersion: string; forgeVersion: string } | null {
  const dash = coordinate.indexOf('-');
  if (dash <= 0) return null;
  return { mcVersion: coordinate.slice(0, dash), forgeVersion: coordinate.slice(dash + 1) };
}

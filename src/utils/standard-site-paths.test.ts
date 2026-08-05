import { describe, expect, test } from "vitest";
import {
  decodeStandardSiteDid,
  documentAtUri,
  parseAtUri,
  publicationAtUri,
  standardSiteDocumentPath,
  standardSiteDocumentUrl,
  standardSitePublicationPath,
  standardSitePublicationUrl,
  standardSiteVerificationPath,
} from "./standard-site-paths";

const did = "did:plc:abcdefghijklmnopqrstuvwx";
const publicationRkey = "3mabcde234567";
const documentRkey = "3mzyxwv765432";

describe("Standard.site canonical paths", () => {
  test("builds a publication URL and its non-root verification endpoint", () => {
    expect(standardSitePublicationPath(did, publicationRkey)).toBe(
      "/at/did%3Aplc%3Aabcdefghijklmnopqrstuvwx/3mabcde234567",
    );
    expect(standardSitePublicationUrl(did, publicationRkey)).toBe(
      "https://twyne.love/at/did%3Aplc%3Aabcdefghijklmnopqrstuvwx/3mabcde234567",
    );
    expect(standardSiteVerificationPath(did, publicationRkey)).toBe(
      "/.well-known/site.standard.publication/at/did%3Aplc%3Aabcdefghijklmnopqrstuvwx/3mabcde234567",
    );
  });

  test("uses the document rkey as the publication-relative path", () => {
    expect(standardSiteDocumentPath(documentRkey)).toBe("/3mzyxwv765432");
    expect(standardSiteDocumentUrl(did, publicationRkey, documentRkey)).toBe(
      "https://twyne.love/at/did%3Aplc%3Aabcdefghijklmnopqrstuvwx/3mabcde234567/3mzyxwv765432",
    );
  });

  test("round-trips route DIDs and AT-URIs", () => {
    expect(decodeStandardSiteDid(encodeURIComponent(did))).toBe(did);
    expect(parseAtUri(publicationAtUri(did, publicationRkey))).toEqual({
      did,
      collection: "site.standard.publication",
      rkey: publicationRkey,
    });
    expect(parseAtUri(documentAtUri(did, documentRkey))).toEqual({
      did,
      collection: "site.standard.document",
      rkey: documentRkey,
    });
  });

  test("rejects malformed route and record identifiers", () => {
    expect(decodeStandardSiteDid("not-a-did")).toBeNull();
    expect(parseAtUri("https://example.com/post")).toBeNull();
    expect(() => standardSiteDocumentPath("not-a-tid")).toThrow(
      "Invalid ATProto record key",
    );
  });
});

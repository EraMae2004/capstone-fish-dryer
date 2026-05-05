import type { TextStyle } from "react-native";

/**
 * Shared *metrics only* (sizes/weights). Do not put colors here — screens keep their own palette.
 */
export const userTypography = {
  pageTitle: {
    fontSize: 20,
    fontWeight: "700",
  } satisfies TextStyle,

  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
  } satisfies TextStyle,

  body: {
    fontSize: 14,
  } satisfies TextStyle,

  bodyStrong: {
    fontSize: 14,
    fontWeight: "600",
  } satisfies TextStyle,

  caption: {
    fontSize: 12,
  } satisfies TextStyle,

  tableHeader: {
    fontSize: 12,
    fontWeight: "700",
  } satisfies TextStyle,

  tableCell: {
    fontSize: 13,
  } satisfies TextStyle,

  emphasis: {
    fontSize: 15,
    fontWeight: "700",
  } satisfies TextStyle,
};

import { createContext } from "react";
import type { BakedPopup } from "./viewerPayload";

/** The payload's popup table (`hovers`), provided once at the viewer's root
 and read by every `BakedCode` tag. */
export const BakedPopups = createContext<BakedPopup[]>([]);

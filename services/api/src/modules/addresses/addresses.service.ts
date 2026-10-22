import { Inject, Injectable } from "@nestjs/common";
import type { RuntimeConfig } from "../../config/runtime-config.js";
import { RUNTIME_CONFIG } from "./addresses.types.js";

@Injectable()
export class AddressesService {
  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}
  list(userId: string) { return []; }
  create(userId: string, input: any) { return { id: "addr-1", ...input }; }
}
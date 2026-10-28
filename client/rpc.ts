import type { PluginRpcContract } from "@getpaseo/plugin";
import type { input, output, ZodType } from "zod";
import { PrivateBridge } from "./bridge";
import { bounded, DirectError } from "./errors";
import { discoverRpc } from "../shared/contracts";

/** App 0.13 may keep an installation (and its original RPC closure) across socket changes. */
export class CurrentHostRpc {
  private serverId: string | null = null;
  constructor(private readonly bootstrap: () => ReturnType<CurrentHostRpc["discover"]>,
    private readonly bridge: () => Pick<PrivateBridge, "invoke"> = PrivateBridge.fromGlobal) {}

  async discover(): Promise<output<typeof discoverRpc.output>> {
    const discovery = this.serverId ? await this.call(discoverRpc, {}) :
      await bounded(this.bootstrap(), new AbortController().signal, 6000);
    if (this.serverId && discovery.serverId !== this.serverId) throw new DirectError("identity");
    this.serverId = discovery.serverId;
    return discovery;
  }
  call = async <I extends ZodType, O extends ZodType>(contract: PluginRpcContract<I, O>, values: input<I>): Promise<output<O>> => {
    if (!this.serverId) throw new DirectError("discovery");
    const input = await contract.input.parseAsync(values);
    const result = await bounded(this.bridge().invoke(this.serverId, contract.name, input), new AbortController().signal, 6000);
    return contract.output.parseAsync(result);
  };
}

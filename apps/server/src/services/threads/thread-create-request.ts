import type { PromptInput, SubmissionMode } from "@bb/domain";
import type {
  CreateThreadRequest,
  EnvironmentArgs,
  ThreadCreateOrigin,
} from "@bb/server-contract";

export interface ThreadCreateServiceRequestInput {
  automationId: string | null;
  environment: EnvironmentArgs;
  executionInputSources?: CreateThreadRequest["executionInputSources"];
  input: PromptInput[];
  model?: CreateThreadRequest["model"];
  origin: ThreadCreateOrigin | null;
  parentThreadId?: string;
  permissionMode?: CreateThreadRequest["permissionMode"];
  projectId: string;
  providerId?: CreateThreadRequest["providerId"];
  reasoningLevel?: CreateThreadRequest["reasoningLevel"];
  serviceTier?: CreateThreadRequest["serviceTier"];
  submissionMode?: CreateThreadRequest["submissionMode"];
  title?: string;
}

export interface ThreadCreateServiceRequest extends Omit<
  ThreadCreateServiceRequestInput,
  "providerId" | "submissionMode"
> {
  providerId: string;
  submissionMode: SubmissionMode;
}

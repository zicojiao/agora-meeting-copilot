export type MeetingPublicationResult = {
  provider: string;
  title: string;
  notesUrl: string;
  transcriptUrl: string;
  publishedAt: string;
};

export interface MeetingPublisher {
  publish(roomId: string): Promise<MeetingPublicationResult | null>;
}

export class NoopMeetingPublisher implements MeetingPublisher {
  async publish() {
    return null;
  }
}

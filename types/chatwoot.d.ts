declare module 'chatwoot-client' {
  interface ContactsAPI {
    get(params: { inboxIdentifier: string; contactIdentifier: string }): Promise<any>;
  }

  interface ChatwootClient {
    client: {
      contacts: ContactsAPI;
    };
  }
}
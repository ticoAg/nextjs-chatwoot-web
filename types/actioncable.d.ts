declare module '@rails/actioncable' {
  export type Subscription = any;
  export const createConsumer: (url: string) => any;
  const ActionCable: any;
  export default ActionCable;
}

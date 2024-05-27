export const block_default = {
  name: "",
  joinable: false,
  components: [],
};

export interface Block {
  name: string;
  joinable: boolean;
  components: any[]; //TODO typing
}

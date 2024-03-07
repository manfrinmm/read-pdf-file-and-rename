import { createWorker, createScheduler, Scheduler } from "tesseract.js";
import fs from "node:fs/promises";
import { pdf } from "pdf-to-img";

async function processFile(file: string, scheduler: Scheduler): Promise<void> {
  let data;

  try {
    const pdfImage = await pdf(`./arquivos/${file}`, { scale: 3 });

    for await (const image of pdfImage) {
      await fs.writeFile(`./tmp/${file}.png`, image);
    }

    const ret = await scheduler.addJob("recognize", `./tmp/${file}.png`);

    await fs.unlink(`./tmp/${file}.png`);

    data = ret.data.text;

    // await fs.writeFile(`${file} - out.txt`, data);

    await fs.appendFile(
      `./out.log`,
      `[${new Date().toISOString()}] [arquivo: ${file}, data:${JSON.stringify(
        data,
      )}]\n`,
    );
  } catch (error) {
    console.log({ file, error });
  }

  if (!data) {
    await fs.rename(`./arquivos/${file}`, `./arquivos/FALHOU - ${file}`);

    return;
  }
  /**
   * Pegar número da nota fiscal
   */
  let number;

  // Ne: 000003911
  number = Number(data.toUpperCase()?.split("NE: ")?.[1]?.split(" ")?.[0]);

  // NF-e N° 000003911
  if (isNaN(number)) {
    number = Number(
      data.toUpperCase()?.split("NF-E")?.[1]?.trim()?.split(" ")?.[1],
    );
  }

  // Não foi possível encontrar a nota fiscal
  if (isNaN(number)) {
    number = "";
  }

  /**
   * Pegar número do pedido
   */
  let pedido;

  // Ne: 000003911
  pedido = Number(
    data
      .split("Pedido")?.[1]
      ?.split(/(\d+)/)
      ?.filter((item: any) => !isNaN(item))?.[0],
  );

  // NF-e N° 000003911
  if (isNaN(pedido)) {
    pedido = Number(
      data.toUpperCase()?.split("NF-E")?.[1]?.trim()?.split(" ")?.[1],
    );
  }

  // Não foi possível encontrar a nota fiscal
  if (isNaN(pedido)) {
    pedido = "";
  }

  /**
   * Pegar nome do cliente
   * - QUANDO O FRETE É POR CONTA DO EMITENTE ("0 -")
   */
  let name = data
    .toUpperCase()
    ?.split("DATA DA EMISSAO")?.[1]
    ?.split(/\d\./)?.[0]
    ?.split(/\d/)?.[0]
    ?.trim();

  if (!name) {
    name = data
      .toUpperCase()
      ?.split("DATA DA EMISSDO")?.[1]
      ?.split(/\d\./)?.[0]
      ?.split(/\d/)?.[0]
      ?.trim();
  }

  if (!name) {
    name = data
      .toUpperCase()
      ?.split("DATA DA EMISSÃO")?.[2]
      ?.split(/\d\./)?.[0]
      ?.split(/\d/)?.[0]
      ?.trim();
  }

  if (!name) {
    name = data
      .toUpperCase()
      ?.split("DATA DA EMISSÃO")?.[1]
      ?.split(/\d\./)?.[0]
      ?.split(/\d/)?.[0]
      ?.trim();
  }

  if (!name) {
    await fs.rename(`./arquivos/${file}`, `./arquivos/FALHOU - ${file}`);

    await fs.appendFile(
      `./falhas.log`,
      `[${new Date().toISOString()}] [arquivo: ${file}, error: Arquivo sem nome, data:${JSON.stringify(
        data,
      )}]\n`,
    );

    return;
  }

  name = name.replace(/[^\w\s]/gi, "");

  try {
    await fs.rename(
      `./arquivos/${file}`,
      `./arquivos/${name} - Nota ${number} - Pedido ${pedido}.pdf`,
    );
  } catch (error: any) {
    await fs.rename(`./arquivos/${file}`, `./arquivos/FALHOU - ${file}`);

    await fs.appendFile(
      `./falhas.log`,
      `[${new Date().toISOString()}] [arquivo: ${file}, error: ${
        error.message
      }, data:${JSON.stringify(data)}]\n`,
    );
  }
}

// Creates worker and adds to scheduler
const workerGen = async (scheduler: Scheduler) => {
  const worker = await createWorker("por");

  scheduler.addWorker(worker);
};

async function main() {
  const files = (await fs.readdir("./arquivos")).filter((file) =>
    file.includes(".pdf"),
  );

  const scheduler = createScheduler();

  /**
   * Crio 10 workers
   */
  console.log("Criando workers");
  console.time("workers");
  const workers = 50;
  await Promise.all(
    Array(workers)
      .fill(0)
      .map(() => workerGen(scheduler)),
  );
  console.log("Workers criados");
  console.timeEnd("workers");

  console.log("Criando fila de processos");
  console.time("process");
  const process = files.map((file) => processFile(file, scheduler));
  console.log("Fila de processos criada");

  console.log("Processando a fila");
  await Promise.all(process);
  console.log("Finalizou a fila");
  console.timeEnd("process");

  await scheduler.terminate();
}

main();

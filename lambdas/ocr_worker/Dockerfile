FROM public.ecr.aws/lambda/python:3.11

RUN dnf install -y \
    mesa-libGL \
    glib2 \
    && dnf clean all

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

ENV TRANSFORMERS_CACHE=/var/task/model_cache
ENV HF_HOME=/var/task/model_cache

RUN python -c "\
    from texify.model.model import load_model; \
    from texify.model.processor import load_processor; \
    print('Downloading model weights...'); \
    load_model(); \
    load_processor(); \
    print('Model weights cached successfully.')"

COPY handler.py ${LAMBDA_TASK_ROOT}/

CMD ["handler.lambda_handler"]

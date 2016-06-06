############################################################
# Dockerfile to build nodejs app
#
# how to build?
# docker build -t reg.docker.pegahtech.ir/backtory/lambda-run-base:latest .
#
# how to push?
# docker push reg.docker.pegahtech.ir/backtory/lambda-run-base:latest
#
############################################################

FROM reg.docker.pegahtech.ir/pegah/ubuntu:14.04
MAINTAINER PegahTech Co.

# Update the repository sources list
# RUN echo "deb http://archive.ubuntu.com/ubuntu trusty main universe" > /etc/apt/sources.list
RUN apt-get update

# Note the new setup script name for Node.js v0.12
RUN curl -sL https://deb.nodesource.com/setup_0.12 | sudo bash -

RUN apt-get install -y sudo
RUN apt-get install -y bc

RUN apt-get install -y nodejs
RUN apt-get install -y npm
